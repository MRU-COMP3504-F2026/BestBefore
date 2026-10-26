import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ScanPage from '../pages/ScanPage'
import { MAX_PHOTO_SIZE } from '../lib/useFoodRecognizer'

const quagga = vi.hoisted(() => ({
  init: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  onDetected: vi.fn(),
  offDetected: vi.fn(),
  onProcessed: vi.fn(),
  offProcessed: vi.fn(),
  CameraAccess: {
    getActiveTrack: vi.fn(),
    enableTorch: vi.fn(),
    disableTorch: vi.fn(),
  },
}))

vi.mock('@ericblade/quagga2', () => ({ default: quagga }))
vi.mock('../lib/authClient', () => ({ getApiToken: async () => 'test-token' }))
// Skip the recognition animation so results show at once.
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}))

const drawImage = vi.fn()
const track = { stop: vi.fn() }
const getUserMedia = vi.fn()
const fetchMock = vi.fn()

const BANANA = {
  identified: true,
  food: { name: 'Banana', category: 'Fresh fruit', quantity: 1, unit: 'piece', ripeness: 'ripe' },
}

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body })
}

function renderScan(Page = ScanPage) {
  return render(
    <MemoryRouter initialEntries={['/scan']}>
      <Routes>
        <Route path="/" element={<p>Home</p>} />
        <Route path="/scan" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  )
}

const aiButton = () => screen.getByRole('button', { name: /AI Vision/ })
const barcodeButton = () => screen.getByRole('button', { name: 'Barcode' })

async function enterAi() {
  await userEvent.click(aiButton())
  await userEvent.click(screen.getByRole('button', { name: 'I Understand, Continue' }))
  await screen.findByText('Center one food item')
}

describe('ScanPage AI Vision (Beta)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    quagga.init.mockResolvedValue(undefined)
    quagga.stop.mockResolvedValue(undefined)
    quagga.CameraAccess.getActiveTrack.mockReturnValue(null)
    getUserMedia.mockResolvedValue({ getTracks: () => [track] })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1280)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(720)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) =>
      callback(new Blob(['jpeg'], { type })),
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AA')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('defaults to Barcode with Quagga running and no AI camera', async () => {
    renderScan()

    expect(barcodeButton()).toHaveAttribute('aria-pressed', 'true')
    expect(aiButton()).toHaveAttribute('aria-pressed', 'false')
    expect(await screen.findByText('Scanning for barcode…')).toBeInTheDocument()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('stops Quagga and shows the dev warning before the AI camera starts', async () => {
    renderScan()
    await screen.findByText('Scanning for barcode…')

    await userEvent.click(aiButton())

    expect(screen.getByRole('alertdialog', { name: 'Development Mode — AI API Usage' })).toBeInTheDocument()
    expect(screen.getByText('DEV ONLY, be mindful of API limits, test accordingly')).toBeInTheDocument()
    await vi.waitFor(() => expect(quagga.stop).toHaveBeenCalled())
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns to Barcode without opening the AI camera on Cancel', async () => {
    renderScan()
    await screen.findByText('Scanning for barcode…')

    await userEvent.click(aiButton())
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(barcodeButton()).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Scanning for barcode…')).toBeInTheDocument()
    expect(quagga.init).toHaveBeenCalledTimes(2)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('opens the rear camera only after confirming, once Quagga has stopped', async () => {
    renderScan()
    await screen.findByText('Scanning for barcode…')

    await enterAi()

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia.mock.lastCall![0].video.facingMode).toBe('environment')
    expect(quagga.stop.mock.invocationCallOrder[0]).toBeLessThan(
      getUserMedia.mock.invocationCallOrder[0],
    )
    expect(screen.getByRole('button', { name: 'Identify Food' })).toBeEnabled()
    // Previewing alone never calls the API.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the warning again every time AI Vision is entered', async () => {
    renderScan()
    await enterAi()

    await userEvent.click(barcodeButton())
    await userEvent.click(aiButton())

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('identifies one still on Identify Food and shows the result inside the frame', async () => {
    respond(200, BANANA)
    renderScan()
    await enterAi()

    await userEvent.click(screen.getByRole('button', { name: 'Identify Food' }))

    expect(await screen.findByText('This is probably')).toBeInTheDocument()
    expect(screen.getByText('Banana')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retake Photo' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.lastCall!
    expect(url).toBe('/api/food/identify')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('image/jpeg')
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(init.body).toBeInstanceOf(Blob)
    // Downscaled before upload, and the camera released once the photo is taken.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, MAX_PHOTO_SIZE, 576)
    expect(track.stop).toHaveBeenCalled()
  })

  it('reopens the camera on Retake Photo without calling the API again', async () => {
    respond(200, BANANA)
    renderScan()
    await enterAi()
    await userEvent.click(screen.getByRole('button', { name: 'Identify Food' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Retake Photo' }))

    expect(await screen.findByText('Center one food item')).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows an unsuccessful identification and lets the user try again', async () => {
    respond(200, { identified: false })
    renderScan()
    await enterAi()

    await userEvent.click(screen.getByRole('button', { name: 'Identify Food' }))

    expect(await screen.findByText('Unable to Identify Food')).toBeInTheDocument()
    expect(screen.queryByText('This is probably')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(await screen.findByText('Center one food item')).toBeInTheDocument()
  })

  it('shows the rate limit message from the server', async () => {
    respond(429, { error: 'AI recognition limit reached. Please wait a bit and try again.' })
    renderScan()
    await enterAi()

    await userEvent.click(screen.getByRole('button', { name: 'Identify Food' }))

    expect(await screen.findByText(/limit reached/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows a connection error without retrying', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    renderScan()
    await enterAi()

    await userEvent.click(screen.getByRole('button', { name: 'Identify Food' }))

    expect(await screen.findByText(/Couldn't reach the server/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a response that does not match the expected shape', async () => {
    respond(200, { identified: true, food: { name: '' } })
    renderScan()
    await enterAi()

    await userEvent.click(screen.getByRole('button', { name: 'Identify Food' }))

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText('This is probably')).not.toBeInTheDocument()
  })

  it('sends only one request while identifying', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderScan()
    await enterAi()

    const identify = screen.getByRole('button', { name: 'Identify Food' })
    await userEvent.click(identify)
    await userEvent.click(identify)

    // Once in the frame and once in the status below it.
    expect(await screen.findAllByText('Identifying food…')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Identifying…' })).toBeDisabled()
    await act(async () => finish({ ok: true, status: 200, json: async () => BANANA }))
    expect(await screen.findByText('Banana')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('releases the AI camera and restarts Quagga when switching back to Barcode', async () => {
    renderScan()
    await enterAi()

    await userEvent.click(barcodeButton())

    expect(track.stop).toHaveBeenCalled()
    expect(await screen.findByText('Scanning for barcode…')).toBeInTheDocument()
    expect(quagga.init).toHaveBeenCalledTimes(2)
  })

  it('releases the AI camera when closed', async () => {
    renderScan()
    await enterAi()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(track.stop).toHaveBeenCalled()
  })

  it('skips the warning in production and opens the camera straight away', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_VERCEL_ENV', 'production')
    vi.resetModules()
    const { default: ProductionScanPage } = await import('../pages/ScanPage')
    renderScan(ProductionScanPage)

    await userEvent.click(aiButton())

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByText('Center one food item')).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})
