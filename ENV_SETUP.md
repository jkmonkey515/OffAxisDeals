# Environment Configuration Setup

This app supports environment-specific configuration for **STAGING** and **PRODUCTION** environments.

## Quick Start

### 1. Create Environment Files

Copy the example files and create your environment configuration:

```bash
# For STAGING
cp .env.staging.example .env.staging

# For PRODUCTION
cp .env.production.example .env.production
```

### 2. Add Your Supabase Credentials

#### For STAGING Environment:

1. Open `.env.staging` in your editor
2. Get your STAGING Supabase credentials:
   - Go to: https://app.supabase.com/project/YOUR_STAGING_PROJECT/settings/api
   - Copy the **Project URL** → paste as `SUPABASE_URL`
   - Copy the **anon/public key** → paste as `SUPABASE_ANON_KEY`

3. Your `.env.staging` should look like:
```env
ENV_NAME=staging
SUPABASE_URL=https://abcdefghijklmnop.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYyMzQ1Njc4OSwiZXhwIjoxOTM5MDMxNzg5fQ.example
```

#### For PRODUCTION Environment:

1. Open `.env.production` in your editor
2. Get your PRODUCTION Supabase credentials:
   - Go to: https://app.supabase.com/project/YOUR_PRODUCTION_PROJECT/settings/api
   - Copy the **Project URL** → paste as `SUPABASE_URL`
   - Copy the **anon/public key** → paste as `SUPABASE_ANON_KEY`

3. Your `.env.production` should look like:
```env
ENV_NAME=production
SUPABASE_URL=https://xyzabcdefghijklm.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5emFiY2RlZmdoaWprbG0iLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYyMzQ1Njc4OSwiZXhwIjoxOTM5MDMxNzg5fQ.example
```

## Using the Configuration

### In Your Code

Import and use the environment configuration:

```typescript
import { env, SUPABASE_URL, SUPABASE_ANON_KEY, ENV_NAME } from './src/config/env';

// Use individual exports
console.log('Environment:', ENV_NAME);
console.log('Supabase URL:', SUPABASE_URL);

// Or use the full config object
console.log('Full config:', env);
```

### Running the App

#### Default (STAGING):
```bash
npm start
```

#### Explicit Environment:
```bash
# Staging
npm run start:staging
npm run android:staging
npm run ios:staging

# Production
npm run start:production
npm run android:production
npm run ios:production
```

## Environment Variable Resolution

The app loads environment variables in this order:
1. `.env.${ENV_NAME}` (e.g., `.env.staging` or `.env.production`)
2. `.env` (base environment file, if it exists)
3. System environment variables

The `ENV_NAME` environment variable determines which config file is loaded:
- `ENV_NAME=staging` → loads `.env.staging`
- `ENV_NAME=production` → loads `.env.production`
- Default: `staging` if not set

## Validation

The app will **fail loudly** if:
- `ENV_NAME` is not "staging" or "production"
- `SUPABASE_URL` is missing or empty
- `SUPABASE_ANON_KEY` is missing or empty

You'll see clear error messages indicating what's missing.

## Security Notes

- ✅ `.env.staging` and `.env.production` are in `.gitignore` (never commit secrets)
- ✅ `.env.example` files are safe to commit (they contain placeholders)
- ⚠️ Never commit actual credentials to version control
- ⚠️ Use different Supabase projects for staging and production

## Troubleshooting

### "Environment configuration is missing"
- Make sure `app.config.js` exists and is properly configured
- Restart the Expo dev server after creating `.env` files

### "SUPABASE_URL is missing or empty"
- Check that your `.env.staging` or `.env.production` file exists
- Verify the file has `SUPABASE_URL=your-url-here` (no quotes needed)
- Make sure there are no extra spaces around the `=` sign

### "Invalid ENV_NAME"
- Ensure `ENV_NAME` is exactly `staging` or `production` (lowercase)
- Check your `.env` file doesn't have quotes around the value

