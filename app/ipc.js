const http = require('http');

/**
 * Creates a simple local IPC server to allow child processes (scripts)
 * to send messages via the running Discord bot.
 */
function createIpcServer(options) {
  const { sendMessage, logger } = options;
  
  const server = http.createServer((req, res) => {
    // Basic security: only accept POST to /message
    if (req.method !== 'POST' || req.url !== '/message') {
      res.statusCode = 405;
      res.end();
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        
        if (!payload.content) {
          throw new Error('Message content is required');
        }

        // Use the bot's sendMessage function
        await sendMessage({
          content: payload.content,
          channelId: payload.channelId,
          threadId: payload.threadId
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        if (logger) logger.error('IPC Server Error', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });

  return {
    start: (port = 0) => new Promise((resolve, reject) => {
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address();
        resolve(addr.port);
      });
      server.on('error', reject);
    }),
    stop: () => new Promise((resolve) => {
      server.close(resolve);
    })
  };
}

module.exports = {
  createIpcServer
};
