/**
 * Netlify Function: ocr-poll
 *
 * Lightweight polling endpoint called by the browser every 2 s to check
 * whether a background OCR job has completed.
 *
 * GET /.netlify/functions/ocr-poll?jobId=<id>
 *
 * Response shapes:
 *   { status: 'pending', progress: 42, pagesDone: 4, pagesTotal: 10 }
 *   { status: 'done',    items: [...], count: N, incomplete: N, excluded: [...], sectionLabels: [...] }
 *   { status: 'error',   error: 'message' }
 *   { status: 'not_found' }   — job not yet written or expired
 *
 * NOTE: This uses Netlify Blobs for cross-instance job state persistence.
 * Jobs are automatically cleaned up after polling completes (24h TTL).
 */

'use strict';

const { getStore } = require('@netlify/blobs');

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
  'Cache-Control':                'no-store',
};

let blobStore;
function getJobStore() {
  if (!blobStore) blobStore = getStore('ocr-jobs');
  return blobStore;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  const { jobId } = event.queryStringParameters || {};
  if (!jobId || !/^[a-zA-Z0-9_-]{8,64}$/.test(jobId)) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Invalid or missing jobId' }),
    };
  }

  try {
    const store = getJobStore();
    const raw = await store.get(jobId);
    
    if (!raw) {
      // Background function may not have written the pending marker yet
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ status: 'not_found' }),
      };
    }

    const data = JSON.parse(raw);
    
    // Clean up completed jobs after successful poll to free storage
    if (data.status === 'done' || data.status === 'error') {
      // Delete in background, don't wait
      store.delete(jobId).catch(err => console.warn('[ocr-poll] Cleanup failed:', err.message));
    }
    
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('[ocr-poll] Error reading job:', err.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ status: 'error', error: 'Failed to read job data: ' + err.message }),
    };
  }
};
