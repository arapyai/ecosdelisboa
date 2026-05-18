import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Onboarding } from '../pages/Onboarding';
import type { Lang } from '../types';

const meta = {
  title: 'Screens/Onboarding',
  component: Onboarding,
  parameters: {
    layout: 'fullscreen'
  }
} satisfies Meta<typeof Onboarding>;

export default meta;
type Story = StoryObj<typeof meta>;

function OnboardingFrame() {
  const [lang, setLang] = useState<Lang>('pt');
  return <Onboarding lang={lang} onLanguage={setLang} onDone={() => undefined} />;
}

export const Default: Story = {
  render: () => <OnboardingFrame />
};
