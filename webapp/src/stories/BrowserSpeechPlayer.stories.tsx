import type { Meta, StoryObj } from '@storybook/react';
import { BrowserSpeechPlayer } from '../components/BrowserSpeechPlayer';

const meta = {
  title: 'UI/BrowserSpeechPlayer',
  component: BrowserSpeechPlayer,
  parameters: {
    layout: 'centered'
  },
  decorators: [
    (Story) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    )
  ]
} satisfies Meta<typeof BrowserSpeechPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Portuguese: Story = {
  args: {
    text: 'Aqui a cidade tem passos de escritorio, cafe e fantasma.',
    lang: 'pt',
    label: 'Ouvir',
    sourceLabel: 'Voz do dispositivo'
  }
};
