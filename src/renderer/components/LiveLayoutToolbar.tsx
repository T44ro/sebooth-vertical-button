import { useNavigate, useLocation } from 'react-router-dom'
import { useAppConfig } from '../stores'
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
        showMarginGuides,
        setShowMarginGuides,
        enableMagneticSnap,
        setEnableMagneticSnap
    } = useAppConfig()

    const navigate = useNavigate()
    const location = useLocation()

    if (!isLayoutEditMode) return null

    const pages = [
        { path: '/', label: '🏠 Beranda' },
        { path: '/frames', label: '🖼️ Frame' },
        { path: '/payment', label: '💳 Payment' },
        { path: '/capture', label: '📸 Capture' },
        { path: '/review', label: '🎨 Review' },
        { path: '/sharing', label: '📲 Sharing' },
        { path: '/printing', label: '🖨️ Printing' }
    ]

    const currentHashOrPath = location.pathname === '/' && window.location.hash
        ? window.location.hash.replace('#', '')
        : location.pathname

    const currentIndex = pages.findIndex(p => p.path === currentHashOrPath || (p.path !== '/' && currentHashOrPath.startsWith(p.path)))
    const activeIndex = currentIndex === -1 ? 0 : currentIndex

    const handleNextPage = () => {
        const nextIdx = (activeIndex + 1) % pages.length
        navigate(pages[nextIdx].path)
    }

    const handlePrevPage = () => {
        const prevIdx = (activeIndex - 1 + pages.length) % pages.length
        navigate(pages[prevIdx].path)
    }

    const handleExit = () => {
        setIsLayoutEditMode(false)
        navigate('/admin')
    }

    return (
        <div className={styles.toolbarContainer}>
            {/* Left: Mode Title & Enable Switch */}
            <div className={styles.leftGroup}>
                <div className={styles.badge}>
                    <span>✏️ LIVE LAYOUT EDITOR</span>
                </div>
                <label className={styles.toggleSwitch} title="Aktifkan/Nonaktifkan Penunjuk Tombol">
                    <input
                        type="checkbox"
                        checked={config.buttonIndicatorEnabled ?? false}
                        onChange={(e) => updateConfig({ buttonIndicatorEnabled: e.target.checked })}
                    />
                    <span className={styles.toggleSlider}></span>
                </label>
            </div>

            {/* Center: Live Page Nav & Indicator Customization */}
            <div className={styles.centerGroup}>
                {/* Page Navigation */}
                <div className={styles.pageNav}>
                    <button className={styles.navButton} onClick={handlePrevPage} title="Halaman Sebelumnya">
                        ◀
                    </button>

                    {pages.map((p, idx) => (
                        <button
                            key={p.path}
                            className={`${styles.navButton} ${idx === activeIndex ? styles.activeNavButton : ''}`}
                            onClick={() => navigate(p.path)}
                        >
                            {p.label}
                        </button>
                    ))}

                    <button className={styles.navButton} onClick={handleNextPage} title="Halaman Selanjutnya">
                        ▶
                    </button>
                </div>

                {/* Text Customization Input */}
                <div className={styles.inputGroup}>
                    <input
                        type="text"
                        className={styles.textInput}
                        value={config.buttonIndicatorText || ''}
                        onChange={(e) => updateConfig({ buttonIndicatorText: e.target.value })}
                        placeholder="Teks Penunjuk..."
                    />
                </div>

                {/* Shape Selector */}
                <select
                    className={styles.selectInput}
                    value={config.buttonIndicatorShape || 'pill'}
                    onChange={(e) => updateConfig({ buttonIndicatorShape: e.target.value as any })}
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
                <div className={styles.inputGroup} title="Warna Background">
                    <input
                        type="color"
                        className={styles.colorPicker}
                        value={config.buttonIndicatorBgColor || '#ef4444'}
                        onChange={(e) => updateConfig({ buttonIndicatorBgColor: e.target.value })}
                    />
                </div>
                <div className={styles.inputGroup} title="Warna Teks">
                    <input
                        type="color"
                        className={styles.colorPicker}
                        value={config.buttonIndicatorTextColor || '#ffffff'}
                        onChange={(e) => updateConfig({ buttonIndicatorTextColor: e.target.value })}
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
