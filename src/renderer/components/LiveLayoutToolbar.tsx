import { useNavigate, useLocation } from 'react-router-dom'
import { useAppConfig } from '../stores'
import { getPageKeyFromRoute, getNormalizedIndicators } from './PhysicalButtonIndicator'
import { ButtonIndicatorItem, PageButtonIndicatorConfig } from '@shared/types'
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
        setEnableMagneticSnap,
        selectedIndicatorId,
        setSelectedIndicatorId
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

    const indicatorsList = getNormalizedIndicators(pageConfig, config)

    const activeSelectedId = (selectedIndicatorId && indicatorsList.some(item => item.id === selectedIndicatorId))
        ? selectedIndicatorId
        : (indicatorsList[0]?.id || 'ind_default')

    const activeItem = indicatorsList.find(item => item.id === activeSelectedId) || indicatorsList[0]

    const updatePageIndicators = (newIndicators: ButtonIndicatorItem[]) => {
        const currentMap = config.pageButtonIndicators || {}
        const currentCustomPage = currentMap[currentPageKey] || {}
        updateConfig({
            pageButtonIndicators: {
                ...currentMap,
                [currentPageKey]: {
                    ...currentCustomPage,
                    indicators: newIndicators
                }
            }
        })
    }

    const updateActiveItem = (updates: Partial<ButtonIndicatorItem>) => {
        const updatedList = indicatorsList.map(item => {
            if (item.id === activeSelectedId) {
                return { ...item, ...updates }
            }
            return item
        })
        updatePageIndicators(updatedList)
    }

    const handleAddIndicator = () => {
        const newId = `ind_${Date.now()}`
        const newItem: ButtonIndicatorItem = {
            id: newId,
            enabled: true,
            text: 'TEKAN TOMBOL ➔',
            x: 50,
            y: 50,
            width: 260,
            height: 70,
            rotation: 0,
            bgColor: '#3b82f6',
            textColor: '#ffffff',
            borderColor: '#ffffff',
            shape: 'pill',
            pulse: true,
            fontSize: 16
        }
        const updatedList = [...indicatorsList, newItem]
        updatePageIndicators(updatedList)
        setSelectedIndicatorId(newId)
    }

    const handleDeleteIndicator = () => {
        if (indicatorsList.length <= 1) return
        const updatedList = indicatorsList.filter(item => item.id !== activeSelectedId)
        updatePageIndicators(updatedList)
        setSelectedIndicatorId(updatedList[0]?.id || null)
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

    const isOverallEnabled = pageConfig.enabled ?? config.buttonIndicatorEnabled ?? true
    const itemText = activeItem?.text || ''
    const itemShape = activeItem?.shape || 'pill'
    const itemBgColor = activeItem?.bgColor || '#ef4444'
    const itemTextColor = activeItem?.textColor || '#ffffff'

    return (
        <div className={styles.toolbarContainer}>
            {/* Left: Mode Title & Overall Page Enable Switch */}
            <div className={styles.leftGroup}>
                <div className={styles.badge}>
                    <span>✏️ LIVE LAYOUT EDITOR</span>
                </div>
                <label className={styles.toggleSwitch} title={`Aktifkan/Nonaktifkan Seluruh Penunjuk untuk Halaman (${currentPageKey.toUpperCase()})`}>
                    <input
                        type="checkbox"
                        checked={isOverallEnabled}
                        onChange={(e) => {
                            const currentMap = config.pageButtonIndicators || {}
                            const currentCustomPage = currentMap[currentPageKey] || {}
                            updateConfig({
                                pageButtonIndicators: {
                                    ...currentMap,
                                    [currentPageKey]: {
                                        ...currentCustomPage,
                                        enabled: e.target.checked
                                    }
                                }
                            })
                        }}
                    />
                    <span className={styles.toggleSlider}></span>
                </label>
            </div>

            {/* Center: Live Page Nav & Multi-Indicator Controls */}
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

                {/* Indicator Tabs Bar per Page */}
                <div className={styles.pageNav} style={{ background: 'rgba(59, 130, 246, 0.15)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                    {indicatorsList.map((item, idx) => (
                        <button
                            key={item.id}
                            className={`${styles.navButton} ${item.id === activeSelectedId ? styles.activeNavButton : ''}`}
                            onClick={() => setSelectedIndicatorId(item.id)}
                            title={`Edit Penunjuk #${idx + 1}`}
                        >
                            #{idx + 1} {item.text ? (item.text.length > 12 ? item.text.substring(0, 10) + '...' : item.text) : 'Penunjuk'}
                        </button>
                    ))}
                    <button
                        className={styles.navButton}
                        onClick={handleAddIndicator}
                        style={{ background: '#10b981', color: 'white', fontWeight: 'bold' }}
                        title="Tambah Penunjuk Tombol Baru ke Halaman Ini"
                    >
                        ➕ Penunjuk Baru
                    </button>
                </div>

                {/* Text Customization Input for Active Selected Indicator */}
                <div className={styles.inputGroup}>
                    <input
                        type="text"
                        className={styles.textInput}
                        value={itemText}
                        onChange={(e) => updateActiveItem({ text: e.target.value })}
                        placeholder="Teks Penunjuk Terpilih..."
                    />
                </div>

                {/* Shape Selector */}
                <select
                    className={styles.selectInput}
                    value={itemShape}
                    onChange={(e) => updateActiveItem({ shape: e.target.value as any })}
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
                <div className={styles.inputGroup} title="Warna Background Penunjuk Ini">
                    <input
                        type="color"
                        className={styles.colorPicker}
                        value={itemBgColor}
                        onChange={(e) => updateActiveItem({ bgColor: e.target.value })}
                    />
                </div>
                <div className={styles.inputGroup} title="Warna Teks Penunjuk Ini">
                    <input
                        type="color"
                        className={styles.colorPicker}
                        value={itemTextColor}
                        onChange={(e) => updateActiveItem({ textColor: e.target.value })}
                    />
                </div>

                {/* Delete Indicator Button */}
                {indicatorsList.length > 1 && (
                    <button
                        className={styles.navButton}
                        onClick={handleDeleteIndicator}
                        style={{ background: '#ef4444', color: 'white', padding: '6px 10px' }}
                        title="Hapus Penunjuk Terpilih Ini"
                    >
                        🗑️ Hapus
                    </button>
                )}

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
