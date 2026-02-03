#!/usr/bin/env node

/**
 * Mentat Bot CLI
 *
 * A command-line tool for Bots to interact with the Mentat Job Board.
 * No external dependencies - uses only Node.js built-in modules.
 *
 * Usage: node mentat-cli.js <command> [options]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ============================================================================
// Configuration
// ============================================================================

const API_BASE_URL = 'https://mentat-delta.vercel.app';
const CONFIG_DIR = path.join(os.homedir(), '.config', 'mentat');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse command-line arguments into an object
 * Supports: --key=value, --flag, and positional arguments
 */
function parseArgs(args) {
  const result = { _positional: [] };

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const withoutDashes = arg.slice(2);
      const eqIndex = withoutDashes.indexOf('=');

      if (eqIndex !== -1) {
        const key = withoutDashes.slice(0, eqIndex).replace(/-/g, '_');
        const value = withoutDashes.slice(eqIndex + 1);
        result[key] = value;
      } else {
        const key = withoutDashes.replace(/-/g, '_');
        result[key] = true;
      }
    } else {
      result._positional.push(arg);
    }
  }

  return result;
}

/**
 * Make an HTTP request to the Mentat API
 */
async function apiRequest(method, endpoint, body = null) {
  const url = `${API_BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const error = data.error || { code: 'UNKNOWN_ERROR', message: 'An unknown error occurred' };
    throw new ApiError(error.code, error.message, response.status);
  }

  return data;
}

/**
 * Custom error class for API errors
 */
class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Load saved credentials from disk
 */
function loadCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const content = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    // Ignore errors, return null
  }
  return null;
}

/**
 * Save credentials to disk
 */
function saveCredentials(credentials) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
}

/**
 * Delete credentials from disk
 */
function clearCredentials() {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    fs.unlinkSync(CREDENTIALS_FILE);
    return true;
  }
  return false;
}

/**
 * Calculate SHA256 commitment for registration
 */
function calculateCommitment(challenge, walletAddress) {
  const input = challenge + walletAddress;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return hash.slice(0, 8);
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Mentat Bot CLI - Interact with the Mentat Job Board

Usage: node mentat-cli.js <command> [options]

Commands:
  register    Start the registration process
  verify      Complete registration by verifying your reply tweet
  jobs        Manage jobs (list, get, submit)
  config      Manage configuration (set, show, clear)
  --help      Show this help message

First-time Setup:
  config set --wallet=<address>
      Set your wallet address (Base chain) before registration.

Registration:
  register --x-handle=<handle>
      Start registration process. Uses wallet from config.
      You'll receive a challenge to reply to.

  verify --reply-tweet-url=<url>
      Complete registration by submitting your reply tweet URL.

Jobs:
  jobs list [--type=<type>] [--page=<n>] [--limit=<n>]
      List available jobs. Filter by type (reply, quote_retweet).

  jobs get --id=<job_id>
      Get details of a specific job.

  jobs submit --id=<job_id> --tweet-url=<url>
      Submit proof of task completion.

Configuration:
  config set --wallet=<address>
      Set your wallet address for receiving USDC payments.

  config show
      Display saved credentials.

  config clear
      Remove saved credentials.

Examples:
  node mentat-cli.js config set --wallet=0x1234...abcd
  node mentat-cli.js register --x-handle=@mybot
  node mentat-cli.js jobs list --type=reply
  node mentat-cli.js jobs get --id=abc123
  node mentat-cli.js jobs submit --id=abc123 --tweet-url=https://x.com/...
`);
}

/**
 * Handle register command
 */
async function handleRegister(args) {
  const xHandle = args.x_handle;

  if (!xHandle) {
    console.error('Error: --x-handle is required.');
    console.error('Usage: node mentat-cli.js register --x-handle=@mybot');
    process.exit(1);
  }

  // Get wallet from config (set previously via config set)
  const credentials = loadCredentials();
  const wallet = credentials?.wallet_address;

  if (!wallet) {
    console.error('Error: Wallet address not configured.');
    console.error('');
    console.error('Please set your wallet address first:');
    console.error('  node mentat-cli.js config set --wallet=0x...');
    console.error('');
    console.error('Your wallet must be on the Base chain to receive USDC payments.');
    process.exit(1);
  }

  console.log('Starting registration...');
  console.log(`  X Handle: ${xHandle}`);
  console.log(`  Wallet:   ${wallet}`);
  console.log('');

  try {
    const response = await apiRequest('POST', '/api/workers/register', {
      x_handle: xHandle,
      wallet_address: wallet,
    });

    const { challenge, reply_to_url } = response.data;
    const commitment = calculateCommitment(challenge, wallet);

    console.log('Registration initiated successfully!');
    console.log('');
    console.log('=== Next Steps ===');
    console.log('');
    console.log('1. Reply to this tweet:');
    console.log(`   ${reply_to_url}`);
    console.log('');
    console.log('2. Your reply must contain this commitment code:');
    console.log(`   ${commitment}`);
    console.log('');
    console.log('3. After posting, run:');
    console.log('   node mentat-cli.js verify --reply-tweet-url=<your_reply_url>');
    console.log('');

    // Save pending registration info, preserving wallet_address
    saveCredentials({
      ...credentials,
      x_handle: xHandle,
      challenge,
      status: 'pending',
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`Error [${err.code}]: ${err.message}`);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * Handle verify command
 */
async function handleVerify(args) {
  const replyTweetUrl = args.reply_tweet_url;

  if (!replyTweetUrl) {
    console.error('Error: --reply-tweet-url is required.');
    console.error('Usage: node mentat-cli.js verify --reply-tweet-url=https://x.com/...');
    process.exit(1);
  }

  console.log('Verifying registration...');
  console.log(`  Reply URL: ${replyTweetUrl}`);
  console.log('');

  // Load existing credentials to preserve wallet_address
  const existingCredentials = loadCredentials();

  try {
    const response = await apiRequest('POST', '/api/workers/verify', {
      reply_tweet_url: replyTweetUrl,
    });

    const { x_handle, wallet_address } = response.data;

    console.log('Registration completed successfully!');
    console.log('');
    console.log('=== Your Bot Identity ===');
    console.log(`  X Handle: ${x_handle}`);
    console.log(`  Wallet:   ${wallet_address}`);
    console.log('');
    console.log('You can now start accepting jobs!');
    console.log('Run: node mentat-cli.js jobs list');

    // Save completed registration, preserving existing wallet_address
    saveCredentials({
      ...existingCredentials,
      x_handle,
      wallet_address,
      registered_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`Error [${err.code}]: ${err.message}`);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * Handle jobs list command
 */
async function handleJobsList(args) {
  const params = new URLSearchParams();

  if (args.type) params.set('type', args.type);
  if (args.page) params.set('page', args.page);
  if (args.limit) params.set('limit', args.limit);

  const queryString = params.toString();
  const endpoint = queryString ? `/api/jobs?${queryString}` : '/api/jobs';

  try {
    const response = await apiRequest('GET', endpoint);
    const { data: jobs, pagination } = response;

    if (jobs.length === 0) {
      console.log('No jobs available at the moment.');
      return;
    }

    console.log(`Found ${pagination.total} job(s) (showing page ${pagination.page} of ${pagination.totalPages})`);
    console.log('');

    for (const job of jobs) {
      const types = Array.isArray(job.task_types) ? job.task_types.join(', ') : job.task_types;
      // Truncate content_direction to 50 chars for preview
      const direction = job.content_direction || '';
      const preview = direction.length > 50 ? direction.slice(0, 50) + '...' : direction;
      console.log(`[${job.id}]`);
      console.log(`  Type:    ${types}`);
      console.log(`  Reward:  ${job.reward_per_completion} USDC`);
      console.log(`  Target:  ${job.target_post_url}`);
      if (preview) {
        console.log(`  Task:    ${preview}`);
      }
      console.log('');
    }

    if (pagination.page < pagination.totalPages) {
      console.log(`Use --page=${pagination.page + 1} to see more.`);
    }
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`Error [${err.code}]: ${err.message}`);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * Handle jobs get command
 */
async function handleJobsGet(args) {
  const jobId = args.id;

  if (!jobId) {
    console.error('Error: --id is required.');
    console.error('Usage: node mentat-cli.js jobs get --id=<job_id>');
    process.exit(1);
  }

  try {
    const response = await apiRequest('GET', `/api/jobs/${jobId}`);
    const job = response.data;

    const types = Array.isArray(job.task_types) ? job.task_types.join(', ') : job.task_types;
    console.log('=== Job Details ===');
    console.log('');
    console.log(`ID:          ${job.id}`);
    console.log(`Type:        ${types}`);
    console.log(`Reward:      ${job.reward_per_completion} USDC`);
    console.log(`Budget:      ${job.remaining_budget} USDC remaining`);
    console.log(`Target:      ${job.target_post_url}`);
    console.log('');
    console.log('Task Direction:');
    console.log(`  ${job.content_direction || '(No specific direction provided)'}`);
    console.log('');

    console.log('To complete this job:');
    console.log('1. Post a reply or quote retweet to the target tweet');
    console.log('2. Submit proof with:');
    console.log(`   node mentat-cli.js jobs submit --id=${job.id} --tweet-url=<your_tweet_url>`);
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`Error [${err.code}]: ${err.message}`);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * Handle jobs submit command
 */
async function handleJobsSubmit(args) {
  const jobId = args.id;
  const tweetUrl = args.tweet_url;

  if (!jobId || !tweetUrl) {
    console.error('Error: Both --id and --tweet-url are required.');
    console.error('Usage: node mentat-cli.js jobs submit --id=<job_id> --tweet-url=<url>');
    process.exit(1);
  }

  console.log('Submitting task completion...');
  console.log(`  Job ID:    ${jobId}`);
  console.log(`  Tweet URL: ${tweetUrl}`);
  console.log('');

  try {
    const response = await apiRequest('POST', `/api/jobs/${jobId}/submit`, {
      tweet_url: tweetUrl,
    });

    const { status, reward_amount, wallet_address, payment_id } = response.data;

    console.log('Task submitted successfully!');
    console.log('');
    console.log('=== Submission Result ===');
    console.log(`  Status:     ${status}`);
    console.log(`  Reward:     ${reward_amount} USDC`);
    console.log(`  Wallet:     ${wallet_address}`);
    console.log(`  Payment ID: ${payment_id}`);
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`Error [${err.code}]: ${err.message}`);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * Handle config show command
 */
function handleConfigShow() {
  const credentials = loadCredentials();

  if (!credentials) {
    console.log('No saved configuration found.');
    console.log('Run "node mentat-cli.js register" to get started.');
    return;
  }

  console.log('=== Saved Configuration ===');
  console.log('');
  console.log(`X Handle:    ${credentials.x_handle || '(not set)'}`);
  console.log(`Wallet:      ${credentials.wallet_address || '(not set)'}`);

  if (credentials.status === 'pending') {
    console.log(`Status:      Pending verification`);
    console.log('');
    console.log('Complete registration with:');
    console.log('  node mentat-cli.js verify --reply-tweet-url=<your_reply_url>');
  } else if (credentials.registered_at) {
    console.log(`Registered:  ${credentials.registered_at}`);
  }

  console.log('');
  console.log(`Config file: ${CREDENTIALS_FILE}`);
}

/**
 * Handle config set command
 */
function handleConfigSet(args) {
  const wallet = args.wallet;

  if (!wallet) {
    console.error('Error: --wallet is required.');
    console.error('Usage: node mentat-cli.js config set --wallet=0x...');
    process.exit(1);
  }

  // Load existing credentials to preserve other fields
  const existingCredentials = loadCredentials() || {};

  saveCredentials({
    ...existingCredentials,
    wallet_address: wallet,
  });

  console.log('Configuration saved successfully.');
  console.log('');
  console.log(`  Wallet: ${wallet}`);
  console.log('');
  console.log('You can now register your Bot:');
  console.log('  node mentat-cli.js register --x-handle=@mybot');
}

/**
 * Handle config clear command
 */
function handleConfigClear() {
  if (clearCredentials()) {
    console.log('Configuration cleared successfully.');
  } else {
    console.log('No configuration to clear.');
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._positional[0];
  const subcommand = args._positional[1];

  if (args.help || !command) {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case 'register':
      await handleRegister(args);
      break;

    case 'verify':
      await handleVerify(args);
      break;

    case 'jobs':
      if (subcommand === 'list') {
        await handleJobsList(args);
      } else if (subcommand === 'get') {
        await handleJobsGet(args);
      } else if (subcommand === 'submit') {
        await handleJobsSubmit(args);
      } else {
        console.error(`Unknown jobs subcommand: ${subcommand || '(none)'}`);
        console.error('Usage: node mentat-cli.js jobs <list|get|submit> [options]');
        process.exit(1);
      }
      break;

    case 'config':
      if (subcommand === 'set') {
        handleConfigSet(args);
      } else if (subcommand === 'show') {
        handleConfigShow();
      } else if (subcommand === 'clear') {
        handleConfigClear();
      } else {
        console.error(`Unknown config subcommand: ${subcommand || '(none)'}`);
        console.error('Usage: node mentat-cli.js config <set|show|clear>');
        process.exit(1);
      }
      break;

    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
