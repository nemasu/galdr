import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const srcDir = 'src/deepseek_v3_tokenizer';
const destDir = 'dist/deepseek_v3_tokenizer';

// Create destination directory if it doesn't exist
if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true });
}

// Copy tokenizer files
const files = ['tokenizer.json', 'tokenizer_config.json'];

files.forEach(file => {
  const srcPath = join(srcDir, file);
  const destPath = join(destDir, file);
  
  if (existsSync(srcPath)) {
    copyFileSync(srcPath, destPath);
    console.log(`Copied ${file} to ${destDir}`);
  } else {
    console.warn(`Warning: ${srcPath} does not exist`);
  }
});