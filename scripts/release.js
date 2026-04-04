/**
 * release.js — Interactive release and tagging script
 * 
 * Usage:
 *   npm run release
 */
const { execSync, spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function exec(cmd) {
  try {
    return execSync(cmd, { stdio: 'inherit', encoding: 'utf8' });
  } catch (e) {
    process.exit(1);
  }
}

async function run() {
  console.log('\n🚀 Starting ATProto Embed Release Process\n');

  // 1. Ask for version type
  const type = await new Promise(resolve => {
    rl.question('Select version bump (patch, minor, major): ', (answer) => {
      const a = answer.toLowerCase().trim();
      if (['patch', 'minor', 'major'].includes(a)) resolve(a);
      else {
        console.log('❌ Invalid type. Please use patch, minor, or major.');
        process.exit(1);
      }
    });
  });

  // 2. Check for uncommitted changes (except package.json, src/ and public/)
  // We want to make sure the user isn't accidentally releasing something they didn't mean to.
  try {
    execSync('git diff-index --quiet HEAD --');
  } catch (e) {
    console.log('\n⚠️  You have uncommitted changes. Please commit or stash them first.');
    process.exit(1);
  }

  console.log(`\n📦 Bumping version (${type})...`);

  // 3. Build the project first to ensure dist is up to date
  console.log('🏗 Building project...');
  exec('npm run build');

  // 4. Run npm version
  // This will update package.json, commit, and tag
  exec(`npm version ${type} -m "Release v%s"`);

  // 5. Push to GitHub
  console.log('\n📤 Pushing to GitHub (including tags)...');
  exec('git push origin main --tags');

  console.log('\n📦 Publishing to npm...');
  exec('npm publish --access public');

  console.log('\n✅ Release complete! GitHub and npm are up to date.');
  rl.close();
}

run();