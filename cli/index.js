const { loadConfig } = require('../app/config');
const { generateReply, formatModelError } = require('../app/runtime');
const { createMemoryInjectionProvider } = require('../app/runtime');
const { loadSkill } = require('../skills/loader');
const path = require('path');

function printUsage() {
  // eslint-disable-next-line no-console
  console.log(`Usage: jevons [options] [message]

Options:
  -h, --help         Show this help message
  -p, --prompt       Read message from stdin instead of arguments
  --scan             Run a single scheduler scan for due reminders

Environment:
  Requires model configuration (provider and model name)
  Optional: GEMINI_API_KEY for memory retrieval

Examples:
  jevons "Hello, world"
  echo "Hello" | jevons -p
  jevons --scan
`);
}

function parseArgs(args) {
  const result = {
    message: null,
    useStdin: false,
    help: false,
    scan: false,
  };

  let collectingMessage = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!collectingMessage && (arg === '-h' || arg === '--help')) {
      result.help = true;
    } else if (!collectingMessage && (arg === '-p' || arg === '--prompt')) {
      result.useStdin = true;
    } else if (!collectingMessage && arg === '--scan') {
      result.scan = true;
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

async function runCli() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const config = loadConfig();
  const discordConfig = config.discord || {};
  const modelConfig = config.model || {};
  const remindersConfig = config.reminders || {};

  if (args.scan) {
    const { createSchedulerService } = require('../scheduler/service');
    const { Client, GatewayIntentBits } = require('discord.js');

    if (!discordConfig.token || !discordConfig.channel_id) {
      console.error('Error: Discord token and channel_id must be configured for scanning');
      process.exitCode = 1;
      return;
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(discordConfig.token);

    const sendMessage = async (payload) => {
      const targetId = payload.threadId || payload.channelId;
      const channel = await client.channels.fetch(targetId);
      if (channel && typeof channel.send === 'function') {
        await channel.send(payload.content);
      }
    };

    const scheduler = createSchedulerService({
      remindersFilePath: remindersConfig.file_path,
      stateFilePath: path.join(__dirname, '../data/scheduler_state.json'),
      sendMessage,
      channelId: discordConfig.channel_id,
      userId: remindersConfig.user_id,
      onLog: (msg) => console.log(`[scheduler] ${msg}`),
      onError: (err) => console.error(`[scheduler] Error: ${err.message}`),
    });

    await scheduler.scan();
    client.destroy();
    return;
  }

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

  // Load and process skills
  const skillsDir = path.join(__dirname, '../skills');
  let loadedSkills = [];
  try {
    loadedSkills = loadSkill({ skillsDir });
    const skillPlaceholders = {
      REMINDERS_FILE_PATH: remindersConfig.file_path,
    };
    loadedSkills = loadedSkills.map(skill => {
      let content = skill.content || '';
      for (const [key, value] of Object.entries(skillPlaceholders)) {
        const placeholder = `{{${key}}}`;
        content = content.split(placeholder).join(value || '');
      }
      return { ...skill, content };
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Warning: Failed to load skills: ${err.message}`);
  }

  const memoryInjection = createMemoryInjectionProvider({
    indexPath: memoryConfig.index_path,
    embeddingApiKey: process.env.GEMINI_API_KEY,
    embeddingModel: memoryConfig.embedding_model,
  });

  const payload = { content: message };
  const options = {
    injection: memoryInjection,
    chatHistory: [], // CLI is stateless - no history
    skills: loadedSkills,
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
