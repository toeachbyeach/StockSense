# Rules

- Whenever you push code to a repository that triggers a GitHub Action, you MUST use the `schedule` tool to monitor the action's progress continuously. Do not end your work until the action completes successfully or fails. If it fails, investigate and fix it. Always notify the user when the action is finished.

## Deployment Monitoring

Whenever you push a change to the repository, you MUST actively monitor the deployment process (e.g. GitHub Actions, Watchtower) to ensure the changes are successfully built and deployed before concluding your task or assuming it is complete.

## GitHub Actions Trigger Policy

- When code that affects the built frontend or runtime assets is changed, ALWAYS trigger the `Build and Push Docker Image` workflow.
- After triggering, MONITOR the workflow run until completion and report the final status to the user.
- If the workflow fails, attempt to collect logs and fix obvious build errors; if the fix requires approval, report back with details and suggested changes.
