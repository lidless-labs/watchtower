import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DeviceLogMessage } from './DeviceLogsPanel'

describe('DeviceLogMessage', () => {
  it('renders device supplied markup as escaped text', () => {
    const message = '<img src=x onerror=alert(1)>'
    const markup = renderToStaticMarkup(<DeviceLogMessage message={message} />)

    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).not.toContain('<img')
  })
})
