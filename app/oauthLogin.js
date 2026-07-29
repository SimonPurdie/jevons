const OPENAI_CODEX_BROWSER_LOGIN_METHOD = 'browser';
const OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD = 'device_code';

function isOpenAICodexLoginMethodPrompt(providerId, selectPrompt) {
  if (providerId !== 'openai-codex' || !Array.isArray(selectPrompt?.options)) {
    return false;
  }
  const optionIds = new Set(selectPrompt.options.map((option) => option.id));
  return optionIds.has(OPENAI_CODEX_BROWSER_LOGIN_METHOD)
    && optionIds.has(OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD);
}

function getForcedOpenAICodexLoginMethod() {
  const value = process.env.JEVONS_OPENAI_CODEX_LOGIN_METHOD?.trim().toLowerCase();
  if (!value) return OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD;
  if (['device', 'device-code', 'device_code', 'headless'].includes(value)) {
    return OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD;
  }
  if (['browser', 'callback', 'local'].includes(value)) {
    return OPENAI_CODEX_BROWSER_LOGIN_METHOD;
  }
  return OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD;
}

export async function selectOAuthOption(selectPrompt, options) {
  const {
    providerId,
    prompt,
    logger = console
  } = options;

  if (isOpenAICodexLoginMethodPrompt(providerId, selectPrompt)) {
    const method = getForcedOpenAICodexLoginMethod();
    const label = method === OPENAI_CODEX_BROWSER_LOGIN_METHOD ? 'browser callback' : 'device-code';
    logger.log(`\nUsing OpenAI Codex ${label} login.`);
    if (method === OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD) {
      logger.log('This avoids localhost OAuth callback failures such as "Callback route not found".');
      logger.log('Set JEVONS_OPENAI_CODEX_LOGIN_METHOD=browser to force browser callback login.');
    }
    return method;
  }

  logger.log(`\n${selectPrompt.message}`);
  selectPrompt.options.forEach((option, index) => {
    logger.log(`${index + 1}. ${option.label}`);
  });
  const choice = await prompt('Select an option (blank to cancel): ');
  const index = Number.parseInt(choice.trim(), 10) - 1;
  return selectPrompt.options[index]?.id;
}
