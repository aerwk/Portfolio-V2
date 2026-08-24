# Blog Posts Setup

This folder contains markdown blog posts organized by category, with a sidebar navigation system for browsing. Posts are automatically rendered on the website using client-side rendering with a folder-like navigation structure.

## How It Works

1. **Obsidian Journal Source:** Posts come from your `/YKL AI Brain/01 Journals/` folder
2. **Auto-Generation:** Run `npm run blog:generate` to scan your journals and create the manifest
3. **YAML Frontmatter:** Add metadata to journal files you want to publish:
   ```markdown
   ---
   title: "Your Post Title"
   date: 2026-06-10
   excerpt: "Brief summary"
   category: "Career"
   tags: [tag1, tag2]
   ---
   ```
4. **posts.json Manifest:** Script auto-generates manifest with all published posts
5. **Client-Side Rendering:** Website uses `marked.js` to convert markdown to HTML
6. **Dynamic Loading:** Posts load and render in the browser
7. **Sidebar Navigation:** Blog reader displays folder-like sidebar for easy browsing

## Folder Structure

```
/blog/posts/
├── posts.json          # Manifest file (defines structure)
├── README.md           # This file
├── infrastructure/
│   └── homelab-setup.md
├── career/
│   └── career-transition.md
├── development/
│   └── responsive-design.md
└── (add more categories/posts as needed)
```

## Creating a New Blog Post

### 1. Create a markdown file

Save a new file in this folder: `your-post-slug.md`

### 2. Add YAML frontmatter

Start your post with metadata in this format:

```yaml
---
title: Your Blog Post Title
date: 2026-06-09
excerpt: A short excerpt that appears in the blog index (1-2 sentences)
category: Development
tags:
  - tag1
  - tag2
  - tag3
---
```

### 3. Write your content

After the `---`, write your blog post in markdown:

```markdown
## Your Heading

This is a paragraph with **bold**, *italic*, and `code`.

### Subheading

- List item 1
- List item 2

> A blockquote

```code block```
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `title` | ✅ Yes | Your blog post title |
| `date` | ✅ Yes | Publication date (YYYY-MM-DD format) |
| `excerpt` | ✅ Yes | Short description for blog index |
| `category` | ❌ No | Category tag (appears on post) |
| `tags` | ❌ No | List of tags for the post |

## Example Post

```markdown
---
title: Getting Started with Docker
date: 2026-06-10
excerpt: A beginner-friendly guide to containerization with Docker.
category: DevOps
tags:
  - Docker
  - Containers
  - DevOps
---

## Introduction

Docker makes it easy to package applications...

## Installation

To install Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

## Your First Container

```bash
docker run -d -p 80:80 nginx:latest
```

This runs an Nginx web server...
```

## Adding Posts to the Blog

To add a new blog post:

### 1. Create the Markdown File

Save your post in an organized folder structure:
- `infrastructure/your-post.md` — For infrastructure posts
- `career/your-post.md` — For career posts
- `development/your-post.md` — For development posts
- Or create a new category folder like `tutorials/`

### 2. Update posts.json Manifest

Update `/blog/posts/posts.json` to include your new post:

```json
{
  "posts": [
    {
      "id": "your-post-slug",
      "path": "category/your-post-slug",
      "title": "Your Post Title",
      "date": "2026-06-10",
      "excerpt": "Short excerpt for the blog listing",
      "category": "Category Name"
    }
  ],
  "folders": {
    "category": {
      "name": "Category Name",
      "posts": ["your-post-slug"]
    }
  }
}
```

### 3. That's It!

The blog reader will automatically:
- Discover your post from the manifest
- Add it to the sidebar under the correct category
- Load and render it when clicked

No code changes needed beyond updating `posts.json`!

## Markdown Formatting

The blog supports standard markdown:

### Headings
```markdown
# H1
## H2
### H3
```

### Lists
```markdown
- Bullet point
- Another point

1. Numbered item
2. Another item
```

### Code
```markdown
Inline `code` in text

```javascript
// Code blocks
const hello = "world";
```
```

### Emphasis
```markdown
**bold**
*italic*
***bold italic***
```

### Links & Images
```markdown
[Link text](https://example.com)
![Alt text](image.jpg)
```

### Blockquotes
```markdown
> A blockquote
> with multiple lines
```

## Best Practices

1. **Use descriptive slugs:** `my-great-post.md` (not `post1.md`)
2. **Keep excerpts short:** 1-2 sentences max
3. **Use categories wisely:** Development, Career, Infrastructure, etc.
4. **Add relevant tags:** Help readers discover related content
5. **Write clear headings:** Improves readability and SEO
6. **Use code blocks:** Make technical content clear
7. **Proofread:** Check spelling and grammar before publishing

## Publishing from Obsidian

You can write posts in your Obsidian vault and export them:

1. **Write in Obsidian:** Use your normal workflow
2. **Export as markdown:** File → Export → Markdown
3. **Copy to blog/posts:** Paste the file here
4. **Update frontmatter:** Add YAML metadata if needed
5. **Update POST_FILES:** Add the filename to the list

## Viewing Your Blog

- **Blog index:** Visit `/blog`
- **Single post:** Posts are viewed at `/blog/posts/view.html?post=post-slug`
- **Direct link:** The blog index generates links automatically

## Markdown Features Supported

✅ Headings (H1-H6)
✅ Paragraphs
✅ Lists (ordered & unordered)
✅ Code blocks (with syntax highlighting via Prism)
✅ Inline code
✅ Bold, italic, strikethrough
✅ Blockquotes
✅ Links
✅ Images
✅ Horizontal rules
✅ Tables

## Troubleshooting

**Post not showing in blog index:**
- Check the filename matches what's in `POST_FILES`
- Verify frontmatter YAML is valid (use an online YAML checker)
- Check browser console for errors (F12)

**Formatting not displaying correctly:**
- Ensure you're using proper markdown syntax
- Check for typos in markdown (e.g., `**bold**` not `*bold*`)
- Verify code blocks have language specified (e.g., ````javascript)

**Post not rendering:**
- Verify frontmatter has all required fields (title, date, excerpt)
- Check that the markdown file has proper encoding (UTF-8)
- Test with a simpler post first

## File Structure

```
/blog
├── index.html          # Blog index/listing page
└── posts
    ├── view.html       # Blog post viewer (loads markdown)
    ├── README.md       # This file
    ├── homelab-setup.md
    ├── career-transition.md
    ├── responsive-design.md
    └── your-post.md    # Your new posts go here
```
