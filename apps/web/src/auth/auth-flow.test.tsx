import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '@/App';
import { tr } from '@/i18n/tr';
import { panelModules } from '@/modules';
import { createFakeAuthClient } from '@/test/fake-auth-client';
import { PanelApiProvider } from '@/data/PanelApiContext';
import { FakePanelApi } from '@/test/fake-panel-api';
import { AuthProvider } from './AuthContext';

const creds = { email: 'owner@ajna.test', password: 'correct horse', totpCode: '123456' };

function renderApp(hasFactor = false) {
  const fake = createFakeAuthClient({ ...creds, hasFactor });
  render(
    <MemoryRouter>
      <AuthProvider client={fake.client}>
        <PanelApiProvider api={new FakePanelApi()}>
          <App />
        </PanelApiProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  return fake;
}

async function signIn(password = creds.password) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(tr.login.email), creds.email);
  await user.type(screen.getByLabelText(tr.login.password), password);
  await user.click(screen.getByRole('button', { name: tr.login.submit }));
  return user;
}

describe('auth flow', () => {
  it('first login forces TOTP enrollment before the panel opens', async () => {
    const fake = renderApp(false);
    const user = await signIn();

    expect(await screen.findByRole('heading', { name: tr.enroll.title })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(await screen.findByAltText(tr.enroll.qrAlt)).toBeInTheDocument();
    expect(fake.calls.enroll).toBe(1);

    await user.type(screen.getByLabelText(tr.verify.code), creds.totpCode);
    await user.click(screen.getByRole('button', { name: tr.verify.submit }));

    expect(await screen.findByRole('heading', { name: 'Bugün' })).toBeInTheDocument();
  });

  it('returning user must enter a TOTP code; a wrong code keeps the panel closed', async () => {
    renderApp(true);
    const user = await signIn();

    expect(await screen.findByRole('heading', { name: tr.verify.title })).toBeInTheDocument();
    await user.type(screen.getByLabelText(tr.verify.code), '000000');
    await user.click(screen.getByRole('button', { name: tr.verify.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(tr.verify.invalid);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(tr.verify.code), creds.totpCode);
    await user.click(screen.getByRole('button', { name: tr.verify.submit }));
    expect(await screen.findByRole('heading', { name: 'Bugün' })).toBeInTheDocument();
  });

  it('wrong password shows an error', async () => {
    renderApp(true);
    await signIn('wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent(tr.login.invalid);
  });

  it('the panel lists every module in Turkish', async () => {
    renderApp(true);
    const user = await signIn();
    await user.type(await screen.findByLabelText(tr.verify.code), creds.totpCode);
    await user.click(screen.getByRole('button', { name: tr.verify.submit }));

    await screen.findByRole('heading', { name: 'Bugün' });
    for (const m of panelModules) {
      expect(screen.getAllByRole('link', { name: m.label }).length).toBeGreaterThan(0);
    }
  });
});
