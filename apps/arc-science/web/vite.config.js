import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[tailwindcss()],server:{proxy:{'/api':'http://127.0.0.1:8080','/health':'http://127.0.0.1:8080'}},build:{outDir:'dist'},test:{environment:'jsdom',setupFiles:['./src/test-setup.js']}});
