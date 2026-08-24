#!/usr/bin/env node

/**
 * Regenerate Blog Manifest (CI-safe version)
 *
 * Reads markdown files already in blog/posts/ and rebuilds posts.json.
 * Does NOT copy files — just regenerates the manifest from what's on disk.
 *
 * Used by: GitHub Actions after a new .md file is pushed to blog/posts/
 * Local use: npm run blog:regenerate
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const BLOG_POSTS_PATH = path.join(__dirname, '../blog/posts');
const MANIFEST_FILE = path.join(BLOG_POSTS_PATH, 'posts.json');

console.log('🔄 Blog Manifest Regenerator');
console.log('=============================\n');
console.log(`📂 Scanning: ${BLOG_POSTS_PATH}\n`);

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
 * Calculate reading time (~200 wpm)
 */
function calculateReadTime(content) {
  return Math.ceil(content.split(/\s+/).length / 200);
}

/**
 * Recursively scan blog/posts/ for .md files with frontmatter
 */
function scanDirectory(dir, relativePath = '') {
  const posts = [];
  const folders = {};

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { posts, folders };
  }

  for (const entry of entries) {
    // Skip hidden files/dirs and the manifest itself
    if (entry.name.startsWith('.') || entry.name === 'posts.json') continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      const { posts: subPosts, folders: subFolders } = scanDirectory(fullPath, relPath);

      if (subPosts.length > 0) {
        folders[entry.name] = {
          name: entry.name,
          posts: subPosts.map(p => p.id)
        };
        posts.push(...subPosts);
        Object.assign(folders, subFolders);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      let parsed;
      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        parsed = matter(raw);
      } catch (err) {
        console.warn(`⚠️  Skipping ${relPath}: ${err.message}`);
        continue;
      }

      const { data: meta, content: body } = parsed;

      // Must have a title to be a publishable post
      if (!meta.title) {
        console.log(`⏭️  Skipping ${relPath} (no title in frontmatter)`);
        continue;
      }

      const slug = meta.slug || generateSlug(entry.name);
      const postPath = relPath.replace(/\\/g, '/').replace(/\.md$/, '');

      const post = {
        id: slug,
        path: postPath,
        title: meta.title,
        date: meta.date || new Date().toISOString().split('T')[0],
        excerpt: meta.excerpt || `${body.slice(0, 150)}...`,
        category: meta.category || 'Journal',
        tags: meta.tags || [],
        readTime: calculateReadTime(body),
        claude_pct: meta.claude_pct !== undefined ? meta.claude_pct : null
      };

      posts.push(post);
      console.log(`✅ ${relPath}`);
    }
  }

  return { posts, folders };
}

// Run
const { posts, folders } = scanDirectory(BLOG_POSTS_PATH);

if (posts.length === 0) {
  console.warn('\n⚠️  No publishable posts found — posts.json will be empty.');
}

// Sort newest first
posts.sort((a, b) => new Date(b.date) - new Date(a.date));

const manifest = {
  posts,
  folders,
  generatedAt: new Date().toISOString(),
  totalPosts: posts.length
};

fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));

console.log(`\n✨ Done — ${posts.length} post(s) indexed`);
console.log(`💾 Saved to: ${MANIFEST_FILE}\n`);
