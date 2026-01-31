const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Load skills from the skills directory.
 * @param {Object} options
 * @param {string} options.skillsDir - Path to skills directory
 * @param {string} options.skillName - Name of skill to load (optional, loads all if not specified)
 * @returns {Object|Array<Object>} Skill(s) with metadata and content
 */
function loadSkill(options = {}) {
  const { skillsDir = './skills', skillName } = options;

  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Skills directory not found: ${skillsDir}`);
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

  if (skillName) {
    const skillPath = path.join(skillsDir, skillName);
    if (!fs.existsSync(skillPath)) {
      throw new Error(`Skill not found: ${skillName}`);
    }
    return loadSkillFromPath(skillPath, skillName);
  }

  const skills = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skill = loadSkillFromPath(path.join(skillsDir, entry.name), entry.name);
      if (skill) {
        skills.push(skill);
      }
    }
  }
  return skills;
}

/**
 * Load a single skill from a directory path.
 * @param {string} skillPath - Full path to skill directory
 * @param {string} name - Skill name
 * @returns {Object|null} Skill object with metadata, content, and scripts
 */
function loadSkillFromPath(skillPath, name) {
  const skill = {
    name,
    path: skillPath,
    content: null,
    scripts: {},
  };

  const entries = fs.readdirSync(skillPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(skillPath, entry.name);
    if (entry.isFile()) {
      if (entry.name === 'skill.md') {
        skill.content = fs.readFileSync(entryPath, 'utf-8');
      } else if (entry.name.endsWith('.sh')) {
        const scriptName = entry.name.replace('.sh', '');
        skill.scripts[scriptName] = entryPath;
      }
    }
  }

  if (!skill.content && Object.keys(skill.scripts).length === 0) {
    return null;
  }

  return skill;
}

/**
 * Execute a skill script via bash.
 * @param {Object} options
 * @param {string} options.scriptPath - Path to the script to execute
 * @param {string[]} options.args - Arguments to pass to script (optional)
 * @param {Object} options.env - Environment variables (optional)
 * @param {number} options.timeout - Timeout in ms (default: 30000)
 * @returns {Promise<Object>} Execution result with stdout, stderr, exitCode
 */
function executeSkillScript(options = {}) {
  const { scriptPath, args = [], env = {}, timeout = 30000 } = options;

  if (!scriptPath) {
    return Promise.reject(new Error('scriptPath is required'));
  }

  if (!fs.existsSync(scriptPath)) {
    return Promise.reject(new Error(`Script not found: ${scriptPath}`));
  }

  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env };
    const child = spawn('bash', [scriptPath, ...args], {
      env: childEnv,
    });

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;
    let timeoutHandle = null;

    if (timeout > 0) {
      timeoutHandle = setTimeout(() => {
        killedByTimeout = true;
        child.kill('SIGTERM');
      }, timeout);
    }

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (signal === 'SIGTERM' && killedByTimeout) {
        reject(new Error(`Script timed out after ${timeout}ms`));
        return;
      }
      resolve({
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        success: code === 0,
        timedOut: killedByTimeout,
      });
    });

    // Track if timeout killed the process
    child.on('exit', (code, signal) => {
      if (signal === 'SIGTERM') {
        killedByTimeout = true;
      }
    });
  });
}

/**
 * Get available scripts for a skill.
 * @param {Object} skill - Skill object from loadSkill
 * @returns {string[]} Array of available script names
 */
function getAvailableScripts(skill) {
  if (!skill || !skill.scripts) {
    return [];
  }
  return Object.keys(skill.scripts);
}

/**
 * Execute a named script from a skill.
 * @param {Object} options
 * @param {Object} options.skill - Skill object
 * @param {string} options.scriptName - Name of script to execute
 * @param {string[]} options.args - Arguments to pass (optional)
 * @param {Object} options.env - Environment variables (optional)
 * @param {number} options.timeout - Timeout in ms (optional)
 * @returns {Promise<Object>} Execution result
 */
async function executeSkill(options = {}) {
  const { skill, scriptName, args = [], env = {}, timeout = 30000 } = options;

  if (!skill) {
    throw new Error('skill is required');
  }

  if (!scriptName) {
    throw new Error('scriptName is required');
  }

  const scriptPath = skill.scripts[scriptName];
  if (!scriptPath) {
    throw new Error(`Script "${scriptName}" not found in skill "${skill.name}"`);
  }

  return executeSkillScript({ scriptPath, args, env, timeout });
}

module.exports = {
  loadSkill,
  executeSkillScript,
  executeSkill,
  getAvailableScripts,
};
