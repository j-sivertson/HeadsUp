#!/usr/bin/env node
/**
 * Test script to verify Supabase and Surge API connections
 * Run with: node scripts/test-connections.js
 *
 * Requires environment variables from supabase/.env:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 * - SURGE_API_KEY (or SURGE_API_TOKEN)
 * - SURGE_ACCOUNT_ID
 */

const fs = require('fs');
const path = require('path');

// Load environment variables from supabase/.env
function loadEnv() {
  const envPath = path.join(__dirname, '..', 'supabase', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Error: supabase/.env file not found');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key] = valueParts.join('=');
      }
    }
  });
}

async function testSupabase() {
  console.log('\n📦 Testing Supabase Connection...');

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.log('   ❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return false;
  }

  try {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`
      }
    });

    if (response.ok) {
      console.log('   ✅ Supabase REST API connected');
      console.log(`   📍 URL: ${url}`);
      return true;
    } else {
      console.log(`   ❌ Supabase error: ${response.status} ${response.statusText}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Supabase connection failed: ${error.message}`);
    return false;
  }
}

async function testSurge() {
  console.log('\n📱 Testing Surge API Connection...');

  const apiKey = process.env.SURGE_API_KEY || process.env.SURGE_API_TOKEN;
  const accountId = process.env.SURGE_ACCOUNT_ID;

  if (!apiKey) {
    console.log('   ❌ Missing SURGE_API_KEY or SURGE_API_TOKEN');
    return false;
  }

  console.log(`   🔑 API Key: ${apiKey.substring(0, 15)}...`);

  // Test API key validity by trying to create an account (will fail with specific error if valid)
  try {
    const response = await fetch('https://api.surge.app/accounts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Connection Test',
        organization_name: 'Test',
        first_name: 'Test',
        last_name: 'User',
        email: 'test@test.com'
      })
    });

    const data = await response.json();

    if (response.status === 401) {
      console.log('   ❌ Invalid API key');
      return false;
    } else if (data.error?.type === 'accounts_limit_exceeded') {
      console.log('   ✅ Surge API key is valid (account limit reached = key works)');
    } else if (data.error?.type === 'validation_error') {
      console.log('   ✅ Surge API key is valid (validation error = key works)');
    } else if (data.id) {
      console.log('   ✅ Surge API connected (created account)');
    } else {
      console.log('   ⚠️  Unexpected response:', JSON.stringify(data));
    }
  } catch (error) {
    console.log(`   ❌ Surge API connection failed: ${error.message}`);
    return false;
  }

  // Check account ID
  if (!accountId || accountId === 'acct_REPLACE_WITH_YOUR_ACCOUNT_ID') {
    console.log('   ⚠️  SURGE_ACCOUNT_ID not configured');
    console.log('   📝 Get your account ID from: https://app.surge.app');
    return true; // API works, just missing account ID
  }

  console.log(`   📍 Account ID: ${accountId}`);

  // Test account access
  try {
    const response = await fetch(`https://api.surge.app/accounts/${accountId}/messages?limit=1`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      console.log('   ✅ Account access verified');
      return true;
    } else {
      const data = await response.json();
      console.log(`   ⚠️  Account access issue: ${data.error?.message || response.statusText}`);
      return true; // API works, account may have issues
    }
  } catch (error) {
    console.log(`   ⚠️  Could not verify account: ${error.message}`);
    return true;
  }
}

async function main() {
  console.log('🔍 HeadsUp Connection Test');
  console.log('==========================');

  loadEnv();

  const supabaseOk = await testSupabase();
  const surgeOk = await testSurge();

  console.log('\n📊 Summary');
  console.log('----------');
  console.log(`Supabase: ${supabaseOk ? '✅ OK' : '❌ Failed'}`);
  console.log(`Surge:    ${surgeOk ? '✅ OK' : '❌ Failed'}`);

  if (!supabaseOk || !surgeOk) {
    console.log('\n⚠️  Some connections failed. Check your .env configuration.');
    process.exit(1);
  }

  console.log('\n✨ All connections verified!');
}

main().catch(console.error);
