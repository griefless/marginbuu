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
 *   { status: 'not_found' }   — job file not yet written (race condition on accept)
 *
 * NOTE: This reads from /tmp which is ephemeral and local to a single Lambda
 * instance.  For production multi-instance deployments replace the /tmp
 * read with a shared store (Netlify Blobs, Redis, etc.).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
  'Cache-Control':                'no-store',
};

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

  const jobFile = path.join('/tmp', `${jobId}.json`);

  if (!fs.existsSync(jobFile)) {
    // Background function may not have written the pending marker yet
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ status: 'not_found' }),
    };
  }

  try {
    const raw  = fs.readFileSync(jobFile, 'utf8');
    const data = JSON.parse(raw);
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ status: 'error', error: 'Failed to read job file: ' + err.message }),
    };
  }
};
