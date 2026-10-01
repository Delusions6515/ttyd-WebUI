// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CreateSessionDialog from './CreateSessionDialog.vue'
import SessionDrawer from './SessionDrawer.vue'
import type { Session } from '../types/session'

const runningSession: Session = {
  name: 'dev_shell',
  shell: 'bash',
  status: 'running',
  port: 7681,
  pid: 100,
  createdAt: '2026-10-01T00:00:00.000Z',
}

const drawerProps = {
  open: true,
  sessions: [runningSession],
  shells: [{ id: 'bash', name: 'Bash' }],
  selectedName: null,
  loading: false,
  shellsLoading: false,
  error: '',
  shellError: '',
  notificationError: '',
  pendingActions: {},
  terminalStatus: 'disconnected' as const,
}

describe('SessionDrawer', () => {
  it('offers session creation from the empty state and selects an existing session', async () => {
    const wrapper = mount(SessionDrawer, { props: { ...drawerProps, sessions: [] } })
    expect(wrapper.text()).toContain('No sessions yet')
    await wrapper.get('[data-testid="create-session"]').trigger('click')
    expect(wrapper.emitted('createRequest')).toHaveLength(1)

    await wrapper.setProps({ sessions: [runningSession] })
    await wrapper.get('[data-testid="session-dev_shell"]').trigger('click')
    expect(wrapper.emitted('selectSession')?.[0]).toEqual(['dev_shell'])
  })

  it('separates terminal connection state from pending lifecycle actions and requires delete confirmation', async () => {
    const wrapper = mount(SessionDrawer, {
      props: { ...drawerProps, selectedName: 'dev_shell', terminalStatus: 'reconnecting', pendingActions: { dev_shell: 'stop' } },
    })
    expect(wrapper.text()).toContain('重连中')
    expect(wrapper.text()).toContain('Stopping…')

    await wrapper.setProps({ pendingActions: {} })
    await wrapper.get('[data-testid="delete-dev_shell"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('will end')
    await wrapper.get('[data-testid="cancel-delete"]').trigger('click')
    expect(wrapper.emitted('deleteSession')).toBeUndefined()

    await wrapper.get('[data-testid="delete-dev_shell"]').trigger('click')
    await wrapper.get('[data-testid="confirm-delete"]').trigger('click')
    expect(wrapper.emitted('deleteSession')?.[0]).toEqual(['dev_shell'])
  })

  it('offers stop and resume separately for running and stopped sessions', async () => {
    const wrapper = mount(SessionDrawer, { props: { ...drawerProps, pendingActions: {} } })
    await wrapper.get('[aria-label="Stop dev_shell"]').trigger('click')
    expect(wrapper.emitted('stopSession')?.[0]).toEqual(['dev_shell'])

    await wrapper.setProps({ sessions: [{ ...runningSession, status: 'stopped', port: null }] })
    await wrapper.get('[aria-label="Resume dev_shell"]').trigger('click')
    expect(wrapper.emitted('restartSession')?.[0]).toEqual(['dev_shell'])
  })

  it('exposes service and notification failures to the user', () => {
    const wrapper = mount(SessionDrawer, {
      props: { ...drawerProps, error: 'Server unavailable', notificationError: 'Updates disconnected; reconnecting' },
    })
    expect(wrapper.text()).toContain('Server unavailable')
    expect(wrapper.text()).toContain('Updates disconnected; reconnecting')
  })
})

describe('CreateSessionDialog', () => {
  it('submits an automatic name and an available shell, preserving a visible error for retry', async () => {
    const wrapper = mount(CreateSessionDialog, {
      props: { open: true, shells: [{ id: 'bash', name: 'Bash' }], pending: false, error: 'Name already exists' },
    })
    expect(wrapper.text()).toContain('Name already exists')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('create')?.[0]).toEqual(['', 'bash'])
  })
})
