declare global {
  interface Window {
    electron: import('@electron-toolkit/preload').ElectronAPI
    api: {
      system: any
      camera: any
      frame: any
      session: any
      database: any
      drive: any
      printer: any
      store: any
      window: any
      email: any
      image: any
      payment: any
    }
  }
}

export {}
