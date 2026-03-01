const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
const BRAND_NAVY = '#1e3a5f'; // From theme/colors.ts

async function inspectImages() {
  console.log('=== Inspecting logo files ===\n');
  const logoFiles = [
    'Off_Axis_Deals_logo_small.png',
    'c__Users_russe_AppData_Roaming_Cursor_User_workspaceStorage_6ff1212b0a210e0457215a6993b686cd_images_Off_Axis_Deals_Logo-2a4d329c-f457-415d-a814-e7e63d7cbd14.png',
    'c__Users_russe_AppData_Roaming_Cursor_User_workspaceStorage_6ff1212b0a210e0457215a6993b686cd_images_Off_Axis_Deals_logo_small-549a259e-e261-406b-9a7f-c7a656efeccb.png',
  ];

  const results = [];
  for (const file of logoFiles) {
    const filePath = path.join(assetsDir, file);
    if (fs.existsSync(filePath)) {
      const metadata = await sharp(filePath).metadata();
      results.push({
        name: file,
        width: metadata.width,
        height: metadata.height,
        size: metadata.size,
        path: filePath,
      });
      console.log(`${file}: ${metadata.width}x${metadata.height} (${(metadata.size / 1024).toFixed(1)}KB)`);
    }
  }

  return results;
}

async function createIcons() {
  const logos = await inspectImages();
  
  if (logos.length === 0) {
    console.error('No logo files found!');
    process.exit(1);
  }

  // Pick the largest logo as source (likely highest quality)
  const sourceLogo = logos.reduce((prev, curr) => 
    (curr.width * curr.height) > (prev.width * prev.height) ? curr : prev
  );

  console.log(`\n=== Using source: ${sourceLogo.name} (${sourceLogo.width}x${sourceLogo.height}) ===\n`);

  const sourcePath = sourceLogo.path;
  const targetSize = 1024;
  const safePadding = 100; // Padding to prevent cropping in Android launcher masks

  try {
    // Create icon.png (1024x1024, solid background)
    console.log('Creating icon.png (1024x1024, solid background)...');
    await sharp(sourcePath)
      .resize(targetSize - (safePadding * 2), targetSize - (safePadding * 2), {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparent for now
      })
      .extend({
        top: safePadding,
        bottom: safePadding,
        left: safePadding,
        right: safePadding,
        background: BRAND_NAVY, // Use brand navy as background
      })
      .toFile(path.join(assetsDir, 'icon.png'));

    console.log('✓ icon.png created');

    // Create adaptive-icon.png (1024x1024, transparent background)
    console.log('Creating adaptive-icon.png (1024x1024, transparent background)...');
    await sharp(sourcePath)
      .resize(targetSize - (safePadding * 2), targetSize - (safePadding * 2), {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .extend({
        top: safePadding,
        bottom: safePadding,
        left: safePadding,
        right: safePadding,
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparent
      })
      .toFile(path.join(assetsDir, 'adaptive-icon.png'));

    console.log('✓ adaptive-icon.png created\n');
    console.log('=== Icon generation complete ===\n');

  } catch (error) {
    console.error('Error creating icons:', error);
    process.exit(1);
  }
}

createIcons();
