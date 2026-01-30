const http = require('http');

/**
 * Sends a message to the running bot process via IPC.
 * Relies on environment variables injected by the bash tool.
 */
async function sendIpcMessage(content) {
  const port = process.env.JEVONS_IPC_PORT;
  const channelId = process.env.JEVONS_CHANNEL_ID;
  const threadId = process.env.JEVONS_THREAD_ID;

  if (!port) {
    // If no IPC port, just fall back to stdout
    return false;
  }

  const payload = JSON.stringify({
    content,
    channelId,
    threadId
  });

  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: '/message',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  sendIpcMessage
};
