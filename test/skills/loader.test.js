const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadSkill, executeSkillScript, executeSkill, getAvailableScripts } = require('../../skills/loader');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-skills-'));
}

function createSkillDir(baseDir, skillName, files) {
  const skillDir = path.join(baseDir, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  for (const [fileName, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(skillDir, fileName), content);
  }
  return skillDir;
}

test('loadSkill throws when skills directory not found', () => {
  assert.throws(() => {
    loadSkill({ skillsDir: '/nonexistent/path' });
  }, /Skills directory not found/);
});

test('loadSkill returns empty array for empty skills directory', () => {
  const dir = makeTempDir();
  const skills = loadSkill({ skillsDir: dir });
  assert.deepEqual(skills, []);
});

test('loadSkill loads all skills from directory', () => {
  const dir = makeTempDir();
  createSkillDir(dir, 'search', {
    'skill.md': '# Search Skill\nDescription here',
    'query.sh': '#!/bin/bash\necho "searching: $1"',
  });
  createSkillDir(dir, 'weather', {
    'skill.md': '# Weather Skill',
  });

  const skills = loadSkill({ skillsDir: dir });
  assert.equal(skills.length, 2);

  const names = skills.map(s => s.name).sort();
  assert.deepEqual(names, ['search', 'weather']);
});

test('loadSkill loads single skill by name', () => {
  const dir = makeTempDir();
  createSkillDir(dir, 'search', {
    'skill.md': '# Search Skill',
    'query.sh': '#!/bin/bash\necho "search"',
  });
  createSkillDir(dir, 'other', {
    'skill.md': '# Other Skill',
  });

  const skill = loadSkill({ skillsDir: dir, skillName: 'search' });
  assert.equal(skill.name, 'search');
  assert.equal(skill.content, '# Search Skill');
  assert.ok(skill.scripts.query);
});

test('loadSkill throws when skill not found by name', () => {
  const dir = makeTempDir();
  assert.throws(() => {
    loadSkill({ skillsDir: dir, skillName: 'nonexistent' });
  }, /Skill not found/);
});

test('loadSkill returns null for skill without content or scripts', () => {
  const dir = makeTempDir();
  fs.mkdirSync(path.join(dir, 'empty'), { recursive: true });

  const skills = loadSkill({ skillsDir: dir });
  assert.equal(skills.length, 0);
});

test('executeSkillScript rejects when scriptPath not provided', async () => {
  await assert.rejects(
    executeSkillScript({}),
    /scriptPath is required/
  );
});

test('executeSkillScript rejects when script not found', async () => {
  await assert.rejects(
    executeSkillScript({ scriptPath: '/nonexistent/script.sh' }),
    /Script not found/
  );
});

test('executeSkillScript executes script successfully', async () => {
  const dir = makeTempDir();
  const scriptPath = path.join(dir, 'test.sh');
  fs.writeFileSync(scriptPath, '#!/bin/bash\necho "hello world"');

  const result = await executeSkillScript({ scriptPath });
  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'hello world');
  assert.equal(result.stderr, '');
});

test('executeSkillScript captures stderr output', async () => {
  const dir = makeTempDir();
  const scriptPath = path.join(dir, 'test.sh');
  fs.writeFileSync(scriptPath, '#!/bin/bash\necho "error msg" >&2');

  const result = await executeSkillScript({ scriptPath });
  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'error msg');
});

test('executeSkillScript captures non-zero exit code', async () => {
  const dir = makeTempDir();
  const scriptPath = path.join(dir, 'test.sh');
  fs.writeFileSync(scriptPath, '#!/bin/bash\necho "failed"\nexit 1');

  const result = await executeSkillScript({ scriptPath });
  assert.equal(result.success, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, 'failed');
});

test('executeSkillScript passes arguments to script', async () => {
  const dir = makeTempDir();
  const scriptPath = path.join(dir, 'test.sh');
  fs.writeFileSync(scriptPath, '#!/bin/bash\necho "args: $@"');

  const result = await executeSkillScript({ scriptPath, args: ['arg1', 'arg2'] });
  assert.equal(result.success, true);
  assert.equal(result.stdout, 'args: arg1 arg2');
});

test('executeSkillScript passes environment variables', async () => {
  const dir = makeTempDir();
  const scriptPath = path.join(dir, 'test.sh');
  fs.writeFileSync(scriptPath, '#!/bin/bash\necho "value: $MY_VAR"');

  const result = await executeSkillScript({ scriptPath, env: { MY_VAR: 'test_value' } });
  assert.equal(result.success, true);
  assert.equal(result.stdout, 'value: test_value');
});

test('executeSkillScript respects timeout', async () => {
  const dir = makeTempDir();
  const scriptPath = path.join(dir, 'test.sh');
  fs.writeFileSync(scriptPath, '#!/bin/bash\nsleep 10');

  await assert.rejects(
    executeSkillScript({ scriptPath, timeout: 100 }),
    /Error/ // Timeout or process termination error
  );
});

test('executeSkillScript handles script errors gracefully', async () => {
  const dir = makeTempDir();
  const scriptPath = path.join(dir, 'test.sh');
  fs.writeFileSync(scriptPath, '#!/bin/bash\ninvalid_command_that_does_not_exist');

  const result = await executeSkillScript({ scriptPath });
  assert.equal(result.success, false);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.length > 0);
});

test('getAvailableScripts returns empty array for null skill', () => {
  const scripts = getAvailableScripts(null);
  assert.deepEqual(scripts, []);
});

test('getAvailableScripts returns script names for skill', () => {
  const skill = {
    name: 'test',
    scripts: {
      query: '/path/query.sh',
      fetch: '/path/fetch.sh',
    },
  };
  const scripts = getAvailableScripts(skill);
  assert.deepEqual(scripts.sort(), ['fetch', 'query']);
});

test('executeSkill throws when skill not provided', async () => {
  await assert.rejects(
    executeSkill({ scriptName: 'test' }),
    /skill is required/
  );
});

test('executeSkill throws when scriptName not provided', async () => {
  const skill = { name: 'test', scripts: {} };
  await assert.rejects(
    executeSkill({ skill }),
    /scriptName is required/
  );
});

test('executeSkill throws when script not found in skill', async () => {
  const skill = { name: 'test', scripts: { other: '/path/other.sh' } };
  await assert.rejects(
    executeSkill({ skill, scriptName: 'missing' }),
    /Script "missing" not found in skill "test"/
  );
});

test('executeSkill executes script from skill', async () => {
  const dir = makeTempDir();
  const scriptPath = path.join(dir, 'query.sh');
  fs.writeFileSync(scriptPath, '#!/bin/bash\necho "executed"');

  const skill = {
    name: 'search',
    scripts: { query: scriptPath },
  };

  const result = await executeSkill({ skill, scriptName: 'query' });
  assert.equal(result.success, true);
  assert.equal(result.stdout, 'executed');
});

test('executeSkill passes args and env to script', async () => {
  const dir = makeTempDir();
  const scriptPath = path.join(dir, 'test.sh');
  fs.writeFileSync(scriptPath, '#!/bin/bash\necho "arg1=$1, var=$MY_VAR"');

  const skill = {
    name: 'test',
    scripts: { run: scriptPath },
  };

  const result = await executeSkill({
    skill,
    scriptName: 'run',
    args: ['value1'],
    env: { MY_VAR: 'env_value' },
  });
  assert.equal(result.success, true);
  assert.equal(result.stdout, 'arg1=value1, var=env_value');
});
