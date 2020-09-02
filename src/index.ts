import * as core from '@actions/core';
import * as github from '@actions/github';
import { IncomingWebhook } from '@slack/webhook';
import { Context } from '@actions/github/lib/context';

function slackSuccessMessage(source: string, target: string, prUrl: string) {
  return {
    color: '#27ae60',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${source} branch has been updated.
pull request to update ${target} branch created:
${prUrl}`,
        },
      },
    ],
  };
}

function slackErrorMessage(source: string, target: string) {
  return {
    color: '#C0392A',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Failed to create pull request from ${source} branch into ${target}`,
        },
      },
    ],
  };
}

async function slackMessage(repo: string, source: string, target: string, prUrl: string, status: string) {
  if (core.getInput('webhook_url')) {
    const slack = new IncomingWebhook(core.getInput('webhook_url'));

    const payload =
      status == 'success' ? slackSuccessMessage(source, target, prUrl) : slackErrorMessage(source, target);

    slack.send({
      username: `${repo} ${source}->${target} sync`,
      icon_emoji: ':github:',
      blocks: payload.blocks,
    });
  }
}

async function createBranch(octokit: any, context: Context, branch: string) {
  try {
    await octokit.repos.getBranch({
      ...context.repo,
      branch,
    });
  } catch (error) {
    if (error.name === 'HttpError' && error.status === 404) {
      await octokit.git.createRef({
        ref: `refs/heads/${branch}`,
        sha: context.sha,
        ...context.repo,
      });
    } else {
      console.log('Error while creating new branch');
      throw Error(error);
    }
  }
}

async function run() {
  const source = core.getInput('source', { required: true });
  const target = core.getInput('target', { required: true });
  const githubToken = core.getInput('github_token', { required: true });

  const repository = github.context.payload.repository!;
  const sourceBranch = source.substring(11);

  try {
    console.log(`Making a pull request for ${target} from ${source}.`);

    const octokit = github.getOctokit(githubToken);

    //part of test
    const { data: currentPulls } = await octokit.pulls.list({
      owner: repository.owner.login,
      repo: repository.name,
    });

    //create new branch from source branch and PR between new branch and target branch
    const context = github.context;
    const newBranch = `${target}-sync-${sourceBranch}-${context.sha.slice(-6)}`;
    await createBranch(octokit, context, newBranch);

    const currentPull = currentPulls.find((pull) => {
      return pull.head.ref === newBranch && pull.base.ref === target;
    });

    if (!currentPull) {
      const { data: pullRequest } = await octokit.pulls.create({
        owner: repository.owner.login,
        repo: repository.name,
        head: newBranch,
        base: target,
        title: `sync: ${target} with ${sourceBranch}`,
        body: `sync-branches: syncing ${target} with ${sourceBranch}`,
        draft: false,
      });

      console.log(`Pull request (${pullRequest.number}) successful! You can view it here: ${pullRequest.html_url}.`);

      core.setOutput('PULL_REQUEST_URL', pullRequest.html_url.toString());
      core.setOutput('PULL_REQUEST_NUMBER', pullRequest.number.toString());
      await slackMessage(repository.name, source, target, pullRequest.html_url.toString(), 'success');
    } else {
      console.log(
        `There is already a pull request (${currentPull.number}) to ${target} from ${newBranch}.`,
        `You can view it here: ${currentPull.html_url}`,
      );
      core.setOutput('PULL_REQUEST_URL', currentPull.url.toString());
      core.setOutput('PULL_REQUEST_NUMBER', currentPull.number.toString());
      await slackMessage(repository.name, sourceBranch, target, currentPull.html_url.toString(), 'success');
    }
  } catch (error) {
    await slackMessage(repository.name, sourceBranch, target, '', 'failure');
    core.setFailed(error.message);
  }
}

run();
