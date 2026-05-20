const { getDefaultConfig } = require('expo/metro-config');

// Default Expo Metro config — adequate for the monorepo because we resolve
// up from this app's node_modules first, then fall through to the workspace
// root. We add the workspace `node_modules` to watchFolders so hot-reload
// picks up shared packages if we ever start using them from mobile.
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
