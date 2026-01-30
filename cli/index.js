const { loadConfig } = require('../app/config');
const { generateReply, formatModelError } = require('../app/runtime');
const { createMemoryInjectionProvider } = require('../app/runtime');

function printUsage() {
  // eslint-disable-next-line no-console
  console.log(`Usage: jevons [options] <message>

Options:
  -h, --help         Show this help message
  -p, --prompt       Read message from stdin instead of arguments

Environment:
  Requires model configuration (provider and model name)
  Optional: GEMINI_API_KEY for memory retrieval

Examples:
  jevons "Hello, world"
  echo "Hello" | jevons -p
`);
}

function parseArgs(args) {
  const result = {
    message: null,
    useStdin: false,
    help: false,
  };

  let collectingMessage = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!collectingMessage && (arg === '-h' || arg === '--help')) {
      result.help = true;
    } else if (!collectingMessage && (arg === '-p' || arg === '--prompt')) {
      result.useStdin = true;
    } else if (!arg.startsWith('-') && result.message === null) {
      result.message = arg;
      collectingMessage = true;
    } else {
      // Once we start collecting message, everything else is part of it
      if (result.message === null) {
        result.message = arg;
      } else {
        result.message += ' ' + arg;
      }
      collectingMessage = true;
    }
  }

  return result;
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
    process.stdin.on('error', (err) => {
      reject(err);
    });
  });
}

function resolvePiAi() {
  try {
    return require('@mariozechner/pi-ai');
  } catch (err) {
    throw new Error('pi-ai is not installed; run npm install');
  }
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const config = loadConfig();
  const modelConfig = config.model || {};

  if (!modelConfig.provider || !modelConfig.model) {
    // eslint-disable-next-line no-console
    console.error('Error: Model provider and model name must be configured');
    // eslint-disable-next-line no-console
    console.error('Set JEVONS_MODEL_PROVIDER and JEVONS_MODEL_NAME environment variables');
    process.exitCode = 1;
    return;
  }

  let message;
  if (args.useStdin) {
    message = await readStdin();
  } else {
    message = args.message;
  }

  if (!message || !message.trim()) {
    // eslint-disable-next-line no-console
    console.error('Error: No message provided');
    printUsage();
    process.exitCode = 1;
    return;
  }

  const piAi = resolvePiAi();
  const model = piAi.getModel(modelConfig.provider, modelConfig.model);

  if (!model) {
    const available = piAi.getModels(modelConfig.provider);
    const names = available.map((entry) => entry.id || entry);
    const preview = names.slice(0, 10).join(', ');
    const suffix = names.length > 10 ? '…' : '';
    // eslint-disable-next-line no-console
    console.error(`Error: Unknown model "${modelConfig.model}" for provider "${modelConfig.provider}". Available: ${preview}${suffix}`);
    process.exitCode = 1;
    return;
  }

  const memoryConfig = config.memory || {};
  const memoryInjection = createMemoryInjectionProvider({
    indexPath: memoryConfig.index_path,
    embeddingApiKey: process.env.GEMINI_API_KEY,
    embeddingModel: memoryConfig.embedding_model,
  });

  const payload = { content: message };
  const options = {
    injection: memoryInjection,
    chatHistory: [], // CLI is stateless - no history
  };

  try {
    const reply = await generateReply(payload, model, piAi.completeSimple, options);
    if (reply) {
      // eslint-disable-next-line no-console
      console.log(reply);
    } else {
      // eslint-disable-next-line no-console
      console.error('Error: No response from model');
      process.exitCode = 1;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(formatModelError(err));
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  readStdin,
  printUsage,
  runCli,
};

if (require.main === module) {
  runCli().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('CLI error:', err.message);
    process.exitCode = 1;
  });
}
