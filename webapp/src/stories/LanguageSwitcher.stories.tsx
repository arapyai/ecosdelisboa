import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import type { Lang } from '../types';

const meta = {
  title: 'UI/LanguageSwitcher',
  component: LanguageSwitcher,
  parameters: {
    layout: 'centered'
  }
} satisfies Meta<typeof LanguageSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

function StatefulLanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const [lang, setLang] = useState<Lang>('pt');
  return <LanguageSwitcher value={lang} onChange={setLang} compact={compact} />;
}

export const Default: Story = {
  render: () => <StatefulLanguageSwitcher />
};

export const Compact: Story = {
  render: () => <StatefulLanguageSwitcher compact />
};
