import { supabaseClient } from '../lib/supabase';
import { qalog, qaError } from './qalog';

/**
 * Uploads a listing image to Supabase Storage.
 * 
 * @param listingId - The ID of the listing (can be a temporary ID before insert)
 * @param ownerId - The ID of the listing owner (auth.uid())
 * @param localUri - Local file URI from image picker
 * @returns Public URL of the uploaded image, or throws an error
 * 
 * @example
 * ```typescript
 * const url = await uploadListingImage('listing-123', 'user-456', 'file:///path/to/image.jpg');
 * ```
 */
export async function uploadListingImage(
  listingId: string,
  ownerId: string,
  localUri: string
): Promise<string> {
  // Generate unique filename: ${ownerId}/${listingId}/${uuid}.jpg
  const uuid = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  const filePath = `${ownerId}/${listingId}/${uuid}.jpg`;

  qalog('listing image upload start', {
    ownerId,
    listingId,
    storagePath: filePath,
  });

  try {
    const response = await fetch(localUri);

    if (!response.ok) {
      throw new Error(`Failed to read image data (status ${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Upload to Supabase Storage
    const { data, error } = await supabaseClient.storage
      .from('listing-images')
      .upload(filePath, bytes, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (error) {
      qaError('listing image upload error', error);
      throw new Error(`Failed to upload image: ${error.message}`);
    }

    // Get public URL
    const { data: urlData } = supabaseClient.storage
      .from('listing-images')
      .getPublicUrl(filePath);

    if (!urlData?.publicUrl) {
      qaError('listing image getPublicUrl error', 'Missing publicUrl');
      throw new Error('Failed to get public URL for uploaded image');
    }

    qalog('listing image upload success', {
      ownerId,
      listingId,
      storagePath: filePath,
      publicUrl: urlData.publicUrl,
    });

    return urlData.publicUrl;
  } catch (err) {
    qaError('listing image upload exception', err);
    throw err;
  }
}

