#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { registerStatusCommand } from './commands/status.js';
import { registerLogsCommand } from './commands/logs.js';
import { registerProjectsCommand } from './commands/projects.js';
import { registerNightCommand } from './commands/night.js';
import { registerDeployCommand } from './commands/deploy.js';

const program = new Command();

program
  .name('ob1')
  .description('OB1 Control — Autonomous IT Department Platform')
  .version('0.1.0');

// Load global config
const config = loadConfig();

// Register commands
registerStatusCommand(program, config);
registerLogsCommand(program, config);
registerProjectsCommand(program, config);
registerNightCommand(program, config);
registerDeployCommand(program, config);

program.parse();
