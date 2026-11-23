/**
 * Factory for creating list integration clients based on provider type.
 */
const HomeAssistantClient = require('./homeAssistant');
const TodoistClient = require('./todoist');
const CaldavClient = require('./caldav');
const GoogleTasksClient = require('./googleTasks');
const MicrosoftTodoClient = require('./microsoftTodo');

function createListClient(provider, config = {}) {
  switch (String(provider).toLowerCase()) {
    case 'homeassistant':
    case 'home_assistant':
    case 'ha':
      return new HomeAssistantClient(config);

    case 'todoist':
      return new TodoistClient(config);

    case 'caldav':
    case 'tasks.org':
    case 'tasksorg':
    case 'apple':
    case 'apple_reminders':
      return new CaldavClient(config);

    case 'googletasks':
    case 'google_tasks':
    case 'google':
      return new GoogleTasksClient(config);

    case 'microsofttodo':
    case 'microsoft_todo':
    case 'mstodo':
    case 'microsoft':
      return new MicrosoftTodoClient(config);

    default:
      throw new Error(`Unsupported list provider: ${provider}`);
  }
}

module.exports = {
  createListClient,
  HomeAssistantClient,
  TodoistClient,
  CaldavClient,
  GoogleTasksClient,
  MicrosoftTodoClient
};
