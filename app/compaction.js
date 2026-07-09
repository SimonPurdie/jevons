import { 
    generateSummary, 
    findCutPoint, 
    DEFAULT_COMPACTION_SETTINGS 
} from '@earendil-works/pi-coding-agent';

/**
 * Performs manual compaction on a session.
 * 
 * @param {Object} session - The DiscordSession object containing sessionManager
 * @param {Object} model - The model instance to use for summarization
 * @param {string} apiKey - The API key for the model
 * @param {string} [customInstructions] - Optional custom focus for the summary
 * @returns {Promise<Object>} The compaction result
 */
export async function performCompaction(session, model, apiKey, customInstructions) {
    const sessionManager = session.sessionManager;
    const branch = sessionManager.getBranch();
    
    if (branch.length === 0) {
        throw new Error('No messages to compact.');
    }

    // Find a cut point using default settings
    const settings = DEFAULT_COMPACTION_SETTINGS;
    // We want to keep about keepRecentTokens
    const cutPoint = findCutPoint(branch, 0, branch.length, settings.keepRecentTokens);
    
    // If we can't find a reasonable cut point, or it's at the very beginning
    if (cutPoint.firstKeptEntryIndex <= 0) {
        // Try to cut at least the first few messages if it's really long
        if (branch.length > 5) {
            cutPoint.firstKeptEntryIndex = Math.floor(branch.length / 2);
        } else {
            throw new Error('Not enough messages to compact. Conversation is too short.');
        }
    }

    const firstKeptEntryId = branch[cutPoint.firstKeptEntryIndex].id;
    
    // Messages to summarize (all messages before the cut point)
    const messagesToSummarize = branch.slice(0, cutPoint.firstKeptEntryIndex)
        .filter(e => e.type === 'message')
        .map(e => e.message);

    if (messagesToSummarize.length === 0) {
        throw new Error('No messages to summarize before the cut point.');
    }

    // Get previous summary for iterative update if available
    let previousSummary;
    for (let i = cutPoint.firstKeptEntryIndex - 1; i >= 0; i--) {
        if (branch[i].type === 'compaction') {
            previousSummary = branch[i].summary;
            break;
        }
    }

    const streamFn = typeof model?.completeSimple === 'function'
        ? async (_model, context, completionOptions) => ({
            result: async () => {
                const response = await model.completeSimple(model, context, completionOptions);
                const content = Array.isArray(response?.content)
                    ? response.content
                    : [{ type: 'text', text: String(response?.content ?? '') }];
                return {
                    ...response,
                    role: response?.role || 'assistant',
                    content,
                    stopReason: response?.stopReason || 'stop',
                };
            },
        })
        : undefined;

    // Generate summary using the LLM
    const summary = await generateSummary(
        messagesToSummarize, 
        model, 
        settings.reserveTokens, 
        apiKey, 
        undefined, 
        undefined, 
        customInstructions, 
        previousSummary,
        undefined,
        streamFn
    );
    
    // Append the compaction to the session
    // We pass 0 for tokensBefore as a simplification
    sessionManager.appendCompaction(summary, firstKeptEntryId, 0);
    
    return { summary };
}
