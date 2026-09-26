import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
// The interface face is loaded from design/fonts, outside this package, as published.
export default defineConfig({plugins:[tailwindcss()],server:{fs:{allow:['.','../../../design/fonts']},proxy:{'/api':'http://127.0.0.1:8080','/health':'http://127.0.0.1:8080'}},build:{outDir:'dist'},test:{environment:'jsdom',setupFiles:['./src/test-setup.js'],exclude:['e2e/**','node_modules/**']}});
