const { spawn } = require('node:child_process');
const { Type } = require('@sinclair/typebox');

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_LINES = 2000;
const MAX_CAPTURE_BYTES = 256 * 1024;

const bashSchema = Type.Object({
  command: Type.String({ description: 'Bash command to execute' }),
  timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (optional)' })),
});

function truncateOutput(output) {
  if (!output) {
    return { text: '(no output)', truncated: false };
  }

  let truncated = false;
  let text = output;

  const lines = text.split('\n');
  if (lines.length > MAX_OUTPUT_LINES) {
    text = lines.slice(-MAX_OUTPUT_LINES).join('\n');
    truncated = true;
  }

  if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) {
    const buffer = Buffer.from(text, 'utf8');
    text = buffer.slice(-MAX_OUTPUT_BYTES).toString('utf8');
    truncated = true;
  }

  return { text: text || '(no output)', truncated };
}

function createBashTool(cwd) {
  return {
    name: 'bash',
    label: 'bash',
    description:
      'Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to a safe tail if large. Optionally provide a timeout in seconds.',
    parameters: bashSchema,
    execute: async (_toolCallId, params, signal) => {
      const command = params && typeof params.command === 'string' ? params.command : '';
      const timeoutSeconds = params && typeof params.timeout === 'number' ? params.timeout : undefined;

      if (!command.trim()) {
        throw new Error('Missing bash command');
      }

      return new Promise((resolve, reject) => {
        let output = '';
        let timedOut = false;
        let finished = false;
        let timeoutHandle;

        const child = spawn('bash', ['-lc', command], {
          cwd,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const appendOutput = (data) => {
          output += data.toString('utf8');
          if (Buffer.byteLength(output, 'utf8') > MAX_CAPTURE_BYTES) {
            output = output.slice(-MAX_CAPTURE_BYTES);
          }
        };

        if (child.stdout) {
          child.stdout.on('data', appendOutput);
        }
        if (child.stderr) {
          child.stderr.on('data', appendOutput);
        }

        const cleanup = () => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
        };

        const finish = (err, exitCode) => {
          if (finished) {
            return;
          }
          finished = true;
          cleanup();

          const truncated = truncateOutput(output);
          let text = truncated.text;

          if (truncated.truncated) {
            text += '\n\n[Output truncated]';
          }

          if (err) {
            return reject(err);
          }

          if (exitCode !== 0 && exitCode !== null) {
            text += `\n\nCommand exited with code ${exitCode}`;
            return reject(new Error(text));
          }

          resolve({
            content: [{ type: 'text', text }],
            details: {
              exitCode,
              truncated: truncated.truncated,
              timedOut,
            },
          });
        };

        const onAbort = () => {
          if (child.pid) {
            child.kill('SIGKILL');
          }
          finish(new Error('Command aborted'));
        };

        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        if (timeoutSeconds && timeoutSeconds > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (child.pid) {
              child.kill('SIGKILL');
            }
            finish(new Error(`Command timed out after ${timeoutSeconds} seconds`));
          }, timeoutSeconds * 1000);
        }

        child.on('error', (err) => finish(err));
        child.on('close', (code) => finish(null, code));
      });
    },
  };
}

module.exports = {
  createBashTool,
};
