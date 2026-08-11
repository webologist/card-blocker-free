const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'public/index.html');
const tsPath = path.join(__dirname, 'lib/website-html.ts');

const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

// Create the TypeScript export with proper backtick handling
// We need to escape backticks inside the template string itself
const escaped = htmlContent
  .replace(/\\/g, '\\\\')      // Escape backslashes
  .replace(/`/g, '\\`')         // Escape backticks for the outer template
  .replace(/\$\{/g, '\\${');    // Escape template expressions

const tsContent = `// This file is auto-generated from public/index.html
export const WEBSITE_HTML_CONTENT = \`${escaped}\`;
`;

fs.writeFileSync(tsPath, tsContent, 'utf-8');
console.log('✅ Regenerated lib/website-html.ts');
