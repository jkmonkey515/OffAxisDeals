# Test Push Edge Function

Dev-only Edge Function to send a test push notification to the current user's enabled push devices.

## Purpose

This function is intended for development and testing only. It allows developers to quickly test push notification delivery without creating saved search matches.

## Usage

### From Mobile App (Dev Only)

The function is called from:
- **DebugQA screen** (if `EXPO_PUBLIC_SHOW_DEBUG_QA=true` and `__DEV__=true`)
- **NotificationSettingsScreen** (if `__DEV__=true`)

Both locations show a "Send Test Push" button that calls this function.

### Manual Invocation

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/test-push \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

## Behavior

1. **Authenticates** the request using the provided Bearer token
2. **Fetches** all enabled push devices for the authenticated user from `push_devices` table
3. **Sends** a test push notification via Expo Push API with:
   - Title: "Test Push"
   - Body: "Test push from Off Axis Deals"
   - Sound: default
   - Data: `{ type: 'test', timestamp: ISO string }`
4. **Returns** success/failure status with device counts

## Response Format

### Success
```json
{
  "ok": true,
  "version": "test-push v1.0.0",
  "devicesCount": 2,
  "successCount": 2,
  "failureCount": 0
}
```

### Partial Success
```json
{
  "ok": true,
  "version": "test-push v1.0.0",
  "devicesCount": 2,
  "successCount": 1,
  "failureCount": 1,
  "failures": ["DeviceRegistrationError: ..."]
}
```

### No Devices
```json
{
  "ok": false,
  "error": "No enabled push devices found for this user",
  "devicesCount": 0
}
```

### Error
```json
{
  "ok": false,
  "error": "Error message here"
}
```

## Security

- **Dev-only**: This function should only be accessible in development builds
- **Authentication required**: Requires valid Bearer token
- **User-scoped**: Only sends to devices belonging to the authenticated user

## Deployment

```bash
supabase functions deploy test-push
```

## Environment Variables

Uses standard Supabase Edge Function environment variables:
- `SUPABASE_URL` (auto-provided)
- `SUPABASE_ANON_KEY` (auto-provided)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-provided, preferred)
