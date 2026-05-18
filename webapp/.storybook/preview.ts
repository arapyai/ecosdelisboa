import type { Preview } from '@storybook/react-vite';
import '../src/styles/global.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i
      }
    },
    backgrounds: {
      default: 'paper',
      values: [
        { name: 'paper', value: '#f4efe7' },
        { name: 'white', value: '#ffffff' },
        { name: 'green', value: '#163832' }
      ]
    }
  }
};

export default preview;
