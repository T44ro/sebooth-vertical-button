import { useNavigate, useLocation } from 'react-router-dom'
import { useAppConfig } from '../stores'
import { getPageKeyFromRoute } from './PhysicalButtonIndicator'
import { PageButtonIndicatorConfig } from '@shared/types'
import styles from './LiveLayoutToolbar.module.css'

export function LiveLayoutToolbar(): JSX.Element | null {
    const {
        config,
        updateConfig,
        isLayoutEditMode,
        setIsLayoutEditMode,
        showGridLines,
        setShowGridLines,
        showCenterLines,
        setShowCenterLines,
        enableMagneticSnap,
        setEnableMagneticSnap
    } = useAppConfig()

    const navigate = useNavigate()
    const location = useLocation()

    if (!isLayoutEditMode) return null

    const pages = [
        { path: '/', key: 'landing', label: '🏠 Beranda' },
        { path: '/frames', key: 'frames', label: '🖼️ Frame' },
        { path: '/payment', key: 'payment', label: '💳 Payment' },
        { path: '/capture', key: 'capture', label: '📸 Capture' },
        { path: '/review', key: 'review', label: '🎨 Review' },
        { path: '/sharing', key: 'sharing', label: '📲 Sharing' },
        { path: '/printing', key: 'printing', label: '🖨️ Printing' }
    ]

    const currentPageKey = getPageKeyFromRoute(location.pathname, window.location.hash)
    const pageMap = config.pageButtonIndicators || {}
    const pageConfig = pageMap[currentPageKey] || {}

    const updatePageConfig = (updates: Partial<PageButtonIndicatorConfig>) => {
        const currentMap = config.pageButtonIndicators || {}
        const currentCustomPage = currentMap[currentPageKey] || {}
        const updatedMap = {
            ...currentMap,
            [currentPageKey]: {
                ...currentCustomPage,
                ...updates
            }
        }
        updateConfig({ pageButtonIndicators: updatedMap })
    }

    const activeIndex = pages.findIndex(p => p.key === currentPageKey)
    const safeIndex = activeIndex === -1 ? 0 : activeIndex

    const handleNextPage = () => {
        const nextIdx = (safeIndex + 1) % pages.length
        navigate(pages[nextIdx].path)
    }

    const handlePrevPage = () => {
        const prevIdx = (safeIndex - 1 + pages.length) % pages.length
        navigate(pages[prevIdx].path)
    }

    const handleExit = () => {
        setIsLayoutEditMode(false)
        navigate('/admin')
    }

    const isEnabled = pageConfig.enabled ?? config.buttonIndicatorEnabled ?? false
    const text = pageConfig.text ?? config.buttonIndicatorText ?? 'TEKAN TOMBOL DI SINI ➔'
    const shape = pageConfig.shape ?? config.buttonIndicatorShape ?? 'pill'
    const bgColor = pageConfig.bgColor ?? config.buttonIndicatorBgColor ?? '#ef4444'
    const textColor = pageConfig.textColor ?? config.buttonIndicatorTextColor ?? '#ffffff'

    return (
        <div className={styles.toolbarContainer}>
            {/* Left: Mode Title & Per-Page Enable Switch */}
            <div className={styles.leftGroup}>
                <div className={styles.badge}>
                    <span>✏️ LIVE LAYOUT EDITOR</span>
                </div>
                <label className={styles.toggleSwitch} title={`Aktifkan/Nonaktifkan Penunjuk Tombol untuk Halaman (${currentPageKey.toUpperCase()})`}>
                    <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => updatePageConfig({ enabled: e.target.checked })}
                    />
                    <span className={styles.toggleSlider}></span>
                </label>
            </div>

            {/* Center: Live Page Nav & Per-Page Indicator Customization */}
            <div className={styles.centerGroup}>
                {/* Page Navigation */}
                <div className={styles.pageNav}>
                    <button className={styles.navButton} onClick={handlePrevPage} title="Halaman Sebelumnya">
                        ◀
                    </button>

                    {pages.map((p, idx) => (
                        <button
                            key={p.path}
                            className={`${styles.navButton} ${idx === safeIndex ? styles.activeNavButton : ''}`}
                            onClick={() => navigate(p.path)}
                        >
                            {p.label}
                        </button>
                    ))}

                    <button className={styles.navButton} onClick={handleNextPage} title="Halaman Selanjutnya">
                        ▶
                    </button>
                </div>

                {/* Text Customization Input for Active Page */}
                <div className={styles.inputGroup}>
                    <input
                        type="text"
                        className={styles.textInput}
                        value={text}
                        onChange={(e) => updatePageConfig({ text: e.target.value })}
                        placeholder="Teks Penunjuk Halaman Ini..."
                    />
                </div>

                {/* Shape Selector */}
                <select
                    className={styles.selectInput}
                    value={shape}
                    onChange={(e) => updatePageConfig({ shape: e.target.value as any })}
                >
                    <option value="pill">💊 Pill</option>
                    <option value="rectangle">⬛ Box</option>
                    <option value="badge">🏷️ Badge</option>
                    <option value="arrow-right">➔ Panah Kanan</option>
                    <option value="arrow-left">⬅ Panah Kiri</option>
                    <option value="arrow-down">⬇ Panah Bawah</option>
                    <option value="arrow-up">⬆ Panah Atas</option>
                </select>

                {/* Background & Text Color Pickers */}
                <div className={styles.inputGroup} title="Warna Background Halaman Ini">
                    <input
                        type="color"
                        className={styles.colorPicker}
                        value={bgColor}
                        onChange={(e) => updatePageConfig({ bgColor: e.target.value })}
                    />
                </div>
                <div className={styles.inputGroup} title="Warna Teks Halaman Ini">
                    <input
                        type="color"
                        className={styles.colorPicker}
                        value={textColor}
                        onChange={(e) => updatePageConfig({ textColor: e.target.value })}
                    />
                </div>

                {/* Guidelines Toggles */}
                <div className={styles.inputGroup} style={{ gap: '8px', fontSize: '11px', opacity: 0.9 }}>
                    <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <input type="checkbox" checked={showGridLines} onChange={(e) => setShowGridLines(e.target.checked)} />
                        Grid
                    </label>
                    <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <input type="checkbox" checked={showCenterLines} onChange={(e) => setShowCenterLines(e.target.checked)} />
                        Center
                    </label>
                    <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <input type="checkbox" checked={enableMagneticSnap} onChange={(e) => setEnableMagneticSnap(e.target.checked)} />
                        🧲 Snap
                    </label>
                </div>
            </div>

            {/* Right: Exit / Save */}
            <div className={styles.rightGroup}>
                <button className={styles.exitButton} onClick={handleExit}>
                    💾 Selesai & Ke Dashboard
                </button>
            </div>
        </div>
    )
}
