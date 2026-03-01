# Supabase Client Usage Examples

This document provides examples of how to use the Supabase client in your Expo React Native app.

## Basic Import

```typescript
import { supabaseClient } from './src/lib/supabase/client';
// Or use the index export
import { supabaseClient } from './src/lib/supabase';
```

## Authentication Examples

### Sign Up

```typescript
import { supabaseClient } from './src/lib/supabase/client';

const signUp = async (email: string, password: string) => {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
  });

  if (error) {
    console.error('Sign up error:', error.message);
    return { error };
  }

  return { data };
};
```

### Sign In

```typescript
import { supabaseClient } from './src/lib/supabase/client';

const signIn = async (email: string, password: string) => {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error('Sign in error:', error.message);
    return { error };
  }

  // Session is automatically persisted via SecureStore
  // User will remain signed in after app restart
  return { data };
};
```

### Sign Out

```typescript
import { supabaseClient } from './src/lib/supabase/client';

const signOut = async () => {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    console.error('Sign out error:', error.message);
    return { error };
  }

  return { success: true };
};
```

### Get Current Session

```typescript
import { supabaseClient } from './src/lib/supabase/client';

const getCurrentSession = async () => {
  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error('Get session error:', error.message);
    return { error };
  }

  return { session };
};
```

### Listen to Auth State Changes

```typescript
import { useEffect } from 'react';
import { supabaseClient } from './src/lib/supabase/client';
import type { Session } from '@supabase/supabase-js';

const useAuth = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, loading };
};
```

## Database Examples

### Select Data

```typescript
import { supabaseClient } from './src/lib/supabase/client';

const getPosts = async () => {
  const { data, error } = await supabaseClient
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching posts:', error.message);
    return { error };
  }

  return { data };
};
```

### Insert Data

```typescript
import { supabaseClient } from './src/lib/supabase/client';

const createPost = async (title: string, content: string) => {
  const { data, error } = await supabaseClient
    .from('posts')
    .insert([
      {
        title,
        content,
        user_id: (await supabaseClient.auth.getUser()).data.user?.id,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Error creating post:', error.message);
    return { error };
  }

  return { data };
};
```

### Update Data

```typescript
import { supabaseClient } from './src/lib/supabase/client';

const updatePost = async (postId: string, updates: { title?: string; content?: string }) => {
  const { data, error } = await supabaseClient
    .from('posts')
    .update(updates)
    .eq('id', postId)
    .select()
    .single();

  if (error) {
    console.error('Error updating post:', error.message);
    return { error };
  }

  return { data };
};
```

### Delete Data

```typescript
import { supabaseClient } from './src/lib/supabase/client';

const deletePost = async (postId: string) => {
  const { error } = await supabaseClient
    .from('posts')
    .delete()
    .eq('id', postId);

  if (error) {
    console.error('Error deleting post:', error.message);
    return { error };
  }

  return { success: true };
};
```

## Real-time Subscriptions

```typescript
import { useEffect } from 'react';
import { supabaseClient } from './src/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

const useRealtimePosts = () => {
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    // Subscribe to changes
    const channel: RealtimeChannel = supabaseClient
      .channel('posts-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'posts',
        },
        (payload) => {
          console.log('Change received!', payload);
          // Update your local state
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, []);

  return posts;
};
```

## Storage Examples

### Upload File

```typescript
import { supabaseClient } from './src/lib/supabase/client';
import * as FileSystem from 'expo-file-system';

const uploadFile = async (fileUri: string, fileName: string) => {
  // Read file as base64
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Convert to blob
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray]);

  // Upload to Supabase Storage
  const { data, error } = await supabaseClient.storage
    .from('your-bucket-name')
    .upload(fileName, blob, {
      contentType: 'image/jpeg', // Adjust based on file type
    });

  if (error) {
    console.error('Upload error:', error.message);
    return { error };
  }

  return { data };
};
```

## Session Persistence

The client is configured to automatically persist sessions using Expo SecureStore:

- ✅ Sessions survive app restarts
- ✅ Sessions are stored securely (Keychain/EncryptedSharedPreferences)
- ✅ Tokens are automatically refreshed
- ✅ No manual session management needed

The session is automatically loaded when the app starts, so users remain signed in.

