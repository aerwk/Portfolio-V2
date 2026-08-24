#!/usr/bin/env node

/**
 * Generate Blog Manifest Script
 *
 * Reads markdown files from your Obsidian vault folder and generates posts.json
 * for the blog system.
 *
 * Usage: node scripts/generate-blog-manifest.js
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// Configuration
const VAULT_JOURNALS_PATH = process.env.VAULT_PATH ||
  path.join(process.env.HOME || process.env.USERPROFILE,
    "claude", "YKL AI Brain", "01 Journals");

const BLOG_POSTS_PATH = path.join(__dirname, '../blog/posts');
const MANIFEST_FILE = path.join(BLOG_POSTS_PATH, 'posts.json');

console.log('📚 Blog Manifest Generator');
console.log('===========================\n');
console.log(`📖 Reading from: ${VAULT_JOURNALS_PATH}`);
console.log(`📝 Writing to: ${MANIFEST_FILE}\n`);

// Check if vault path exists
if (!fs.existsSync(VAULT_JOURNALS_PATH)) {
  console.error(`❌ Error: Vault path not found: ${VAULT_JOURNALS_PATH}`);
  console.error(`\nPlease set VAULT_PATH environment variable or update the path in this script.`);
  process.exit(1);
}

/**
 * Extract frontmatter from markdown content
 */
function extractFrontmatter(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data, content: body } = matter(content);
    return { metadata: data, body };
  } catch (error) {
    console.error(`⚠️  Error reading ${filePath}: ${error.message}`);
    return { metadata: {}, body: '' };
  }
}

/**
 * Generate slug from filename
 */
function generateSlug(filename) {
  return filename
    .replace(/\.md$/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '');
}

/**
 * Calculate reading time
 */
function calculateReadTime(content) {
  const wordCount = content.split(/\s+/).length;
  return Math.ceil(wordCount / 200);
}

/**
 * Copy markdown file to blog posts folder
 */
function copyMarkdownFile(sourcePath, destRelativePath) {
  const destPath = path.join(BLOG_POSTS_PATH, destRelativePath + '.md');
  const destDir = path.dirname(destPath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Copy file
  fs.copyFileSync(sourcePath, destPath);
}

/**
 * Recursively scan directory for markdown files
 */
function scanDirectory(dir, relativePath = '') {
  const posts = [];
  const folders = {};
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  entries.forEach(entry => {
    // Skip hidden files and folders
    if (entry.name.startsWith('.')) return;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      // Recursively scan subdirectories
      const { posts: subPosts, folders: subFolders } = scanDirectory(fullPath, relPath);

      if (subPosts.length > 0) {
        const folderName = entry.name.charAt(0).toUpperCase() + entry.name.slice(1);
        folders[entry.name] = {
          name: folderName,
          posts: subPosts.map(p => p.id)
        };
        posts.push(...subPosts);
      }

      Object.assign(folders, subFolders);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // Process markdown file
      const { metadata, body } = extractFrontmatter(fullPath);

      // Skip if no title (likely a template or config file)
      if (!metadata.title) {
        console.log(`⏭️  Skipping ${relPath} (no title in frontmatter)`);
        return;
      }

      const slug = metadata.slug || generateSlug(entry.name);
      const readTime = calculateReadTime(body);
      const relPathForManifest = relPath.replace(/\\/g, '/').replace(/\.md$/, '');

      // Copy markdown file to blog posts folder
      try {
        copyMarkdownFile(fullPath, relPathForManifest);
      } catch (error) {
        console.error(`⚠️  Error copying ${relPath}: ${error.message}`);
      }

      const post = {
        id: slug,
        path: relPathForManifest,
        title: metadata.title,
        date: metadata.date || new Date().toISOString().split('T')[0],
        excerpt: metadata.excerpt || `${body.slice(0, 150)}...`,
        category: metadata.category || entry.name.split('/')[0] || 'Journal',
        tags: metadata.tags || [],
        readTime
      };

      posts.push(post);
      console.log(`✅ ${relPath}`);
    }
  });

  return { posts, folders };
}

/**
 * Generate manifest file
 */
function generateManifest() {
  const { posts, folders } = scanDirectory(VAULT_JOURNALS_PATH);

  if (posts.length === 0) {
    console.error('\n❌ No markdown files with frontmatter found!');
    console.error('\nMake sure your journal files have frontmatter like:');
    console.error(`\n---
title: Your Post Title
date: 2026-06-10
excerpt: Brief excerpt
category: Journal
tags:
  - tag1
  - tag2
---\n`);
    process.exit(1);
  }

  // Sort posts by date (newest first)
  posts.sort((a, b) => new Date(b.date) - new Date(a.date));

  const manifest = {
    posts,
    folders,
    generatedAt: new Date().toISOString(),
    totalPosts: posts.length
  };

  // Ensure directory exists
  if (!fs.existsSync(BLOG_POSTS_PATH)) {
    fs.mkdirSync(BLOG_POSTS_PATH, { recursive: true });
  }

  // Write manifest
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  console.log(`\n✨ Manifest generated successfully!`);
  console.log(`\n📊 Summary:`);
  console.log(`   • Total posts: ${posts.length}`);
  console.log(`   • Categories: ${Object.keys(folders).length}`);
  Object.entries(folders).forEach(([key, folder]) => {
    console.log(`     - ${folder.name}: ${folder.posts.length} post(s)`);
  });
  console.log(`\n💾 Saved to: ${MANIFEST_FILE}`);
}

// Run generator
try {
  generateManifest();
  console.log('\n✅ Done! Your blog is ready.');
  console.log('\nNext steps:');
  console.log('1. Visit http://localhost:3001/blog');
  console.log('2. Click "Browse Blog Posts"');
  console.log('3. Your journals will appear in the sidebar!\n');
} catch (error) {
  console.error('\n❌ Error generating manifest:', error.message);
  process.exit(1);
}
