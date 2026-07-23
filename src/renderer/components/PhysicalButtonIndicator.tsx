import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { useAppConfig } from '../stores'
import { ButtonIndicatorItem, PageButtonIndicatorConfig } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import styles from './PhysicalButtonIndicator.module.css'

interface PhysicalButtonIndicatorProps {
    isEditing?: boolean
    overrideConfig?: any
    overridePageKey?: string
}

type DragMode = 'move' | 'resize-se' | 'resize-sw' | 'resize-ne' | 'resize-nw' | 'rotate' | null

export const getPageKeyFromRoute = (pathname: string, hash: string): string => {
    const target = hash ? hash.replace('#', '') : pathname
    if (target === '/' || target === '' || target === '/landing') return 'landing'
    if (target.startsWith('/frames')) return 'frames'
    if (target.startsWith('/payment')) return 'payment'
    if (target.startsWith('/capture')) return 'capture'
    if (target.startsWith('/review')) return 'review'
    if (target.startsWith('/sharing')) return 'sharing'
    if (target.startsWith('/printing')) return 'printing'
    return 'landing'
}

// Normalizer: Convert legacy single properties or empty indicators array to clean ButtonIndicatorItem array
export const getNormalizedIndicators = (pageConfig?: PageButtonIndicatorConfig, globalConfig?: any): ButtonIndicatorItem[] => {
    if (pageConfig?.indicators && pageConfig.indicators.length > 0) {
        return pageConfig.indicators
    }

    // Fallback legacy single indicator
    const fallbackEnabled = pageConfig?.enabled ?? globalConfig?.buttonIndicatorEnabled ?? true
    const fallbackText = pageConfig?.text ?? globalConfig?.buttonIndicatorText ?? 'TEKAN TOMBOL DI SINI ➔'
    const fallbackX = pageConfig?.x ?? globalConfig?.buttonIndicatorX ?? 80
    const fallbackY = pageConfig?.y ?? globalConfig?.buttonIndicatorY ?? 50
    const fallbackWidth = pageConfig?.width ?? globalConfig?.buttonIndicatorWidth ?? 260
    const fallbackHeight = pageConfig?.height ?? globalConfig?.buttonIndicatorHeight ?? 70
    const fallbackRotation = pageConfig?.rotation ?? globalConfig?.buttonIndicatorRotation ?? 0
    const fallbackBg = pageConfig?.bgColor ?? globalConfig?.buttonIndicatorBgColor ?? '#ef4444'
    const fallbackTextCol = pageConfig?.textColor ?? globalConfig?.buttonIndicatorTextColor ?? '#ffffff'
    const fallbackBorderCol = pageConfig?.borderColor ?? globalConfig?.buttonIndicatorBorderColor ?? '#ffffff'
    const fallbackShape = pageConfig?.shape ?? globalConfig?.buttonIndicatorShape ?? 'pill'
    const fallbackPulse = pageConfig?.pulse ?? globalConfig?.buttonIndicatorPulse ?? true
    const fallbackFontSize = pageConfig?.fontSize ?? globalConfig?.buttonIndicatorFontSize ?? 16

    return [{
        id: 'ind_default',
        enabled: fallbackEnabled,
        text: fallbackText,
        x: fallbackX,
        y: fallbackY,
        width: fallbackWidth,
        height: fallbackHeight,
        rotation: fallbackRotation,
        bgColor: fallbackBg,
        textColor: fallbackTextCol,
        borderColor: fallbackBorderCol,
        shape: fallbackShape,
        pulse: fallbackPulse,
        fontSize: fallbackFontSize
    }]
}

export function PhysicalButtonIndicator({ isEditing = false, overrideConfig, overridePageKey }: PhysicalButtonIndicatorProps): JSX.Element | null {
    // 1. ALL HOOKS RUN UNCONDITIONALLY AT TOP LEVEL
    const {
        config,
        updateConfig,
        isLayoutEditMode,
        showGridLines,
        showCenterLines,
        showMarginGuides,
        enableMagneticSnap,
        selectedIndicatorId,
        setSelectedIndicatorId
    } = useAppConfig()

    const location = useLocation()

    const currentPageKey = overridePageKey || getPageKeyFromRoute(location.pathname, window.location.hash)
    const pageMap = config.pageButtonIndicators || {}
    const pageConfig = pageMap[currentPageKey]

    const indicatorsList = getNormalizedIndicators(pageConfig, config)

    // Ensure selectedIndicatorId is valid
    const activeSelectedId = (selectedIndicatorId && indicatorsList.some(item => item.id === selectedIndicatorId))
        ? selectedIndicatorId
        : (indicatorsList[0]?.id || 'ind_default')

    const activeItem = indicatorsList.find(item => item.id === activeSelectedId) || indicatorsList[0]

    // Helper to update specific indicator item by ID in page config
    const updateIndicatorItem = useCallback((targetId: string, updates: Partial<ButtonIndicatorItem>) => {
        const currentMap = config.pageButtonIndicators || {}
        const currentCustomPage = currentMap[currentPageKey] || {}
        const currentIndicators = getNormalizedIndicators(currentCustomPage, config)

        const updatedIndicators = currentIndicators.map(item => {
            if (item.id === targetId) {
                return { ...item, ...updates }
            }
            return item
        })

        updateConfig({
            pageButtonIndicators: {
                ...currentMap,
                [currentPageKey]: {
                    ...currentCustomPage,
                    indicators: updatedIndicators
                }
            }
        })
    }, [config, currentPageKey, updateConfig])

    const [dragMode, setDragMode] = useState<DragMode>(null)
    const [dragStart, setDragStart] = useState({
        mouseX: 0,
        mouseY: 0,
        posX: 80,
        posY: 50,
        width: 260,
        height: 70,
        rotation: 0
    })

    const handleMouseDown = useCallback((mode: DragMode, itemId: string, e: React.MouseEvent) => {
        if (!isLayoutEditMode) return
        e.stopPropagation()
        e.preventDefault()

        setSelectedIndicatorId(itemId)

        const targetItem = indicatorsList.find(i => i.id === itemId) || activeItem
        setDragStart({
            mouseX: e.clientX,
            mouseY: e.clientY,
            posX: targetItem.x ?? 80,
            posY: targetItem.y ?? 50,
            width: targetItem.width ?? 260,
            height: targetItem.height ?? 70,
            rotation: targetItem.rotation ?? 0
        })
        setDragMode(mode)
    }, [isLayoutEditMode, indicatorsList, activeItem, setSelectedIndicatorId])

    useEffect(() => {
        if (!dragMode || !isLayoutEditMode || !activeSelectedId) return

        const handleMouseMove = (e: MouseEvent) => {
            const screenW = window.innerWidth
            const screenH = window.innerHeight

            const deltaMouseX = e.clientX - dragStart.mouseX
            const deltaMouseY = e.clientY - dragStart.mouseY

            if (dragMode === 'move') {
                const deltaPercentX = (deltaMouseX / screenW) * 100
                const deltaPercentY = (deltaMouseY / screenH) * 100

                let newX = Math.min(Math.max(dragStart.posX + deltaPercentX, 3), 97)
                let newY = Math.min(Math.max(dragStart.posY + deltaPercentY, 3), 97)

                if (enableMagneticSnap) {
                    if (Math.abs(newX - 50) < 3) newX = 50
                    if (Math.abs(newY - 50) < 3) newY = 50

                    const snappedX10 = Math.round(newX / 10) * 10
                    if (Math.abs(newX - snappedX10) < 1.5) newX = snappedX10

                    const snappedY10 = Math.round(newY / 10) * 10
                    if (Math.abs(newY - snappedY10) < 1.5) newY = snappedY10
                }

                updateIndicatorItem(activeSelectedId, {
                    x: Math.round(newX * 10) / 10,
                    y: Math.round(newY * 10) / 10
                })
            } else if (dragMode.startsWith('resize')) {
                const isSE = dragMode === 'resize-se'
                const isSW = dragMode === 'resize-sw'
                const isNE = dragMode === 'resize-ne'
                const isNW = dragMode === 'resize-nw'

                let newW = dragStart.width
                let newH = dragStart.height

                if (isSE || isNE) newW += deltaMouseX * 1.5
                if (isSW || isNW) newW -= deltaMouseX * 1.5

                if (isSE || isSW) newH += deltaMouseY * 1.5
                if (isNE || isNW) newH -= deltaMouseY * 1.5

                newW = Math.max(120, Math.min(600, Math.round(newW)))
                newH = Math.max(40, Math.min(350, Math.round(newH)))

                updateIndicatorItem(activeSelectedId, {
                    width: newW,
                    height: newH
                })
            } else if (dragMode === 'rotate') {
                const centerX = screenW * (dragStart.posX / 100)
                const centerY = screenH * (dragStart.posY / 100)

                const radians = Math.atan2(e.clientY - centerY, e.clientX - centerX)
                let degrees = Math.round(radians * (180 / Math.PI))
                if (degrees < 0) degrees += 360

                if (enableMagneticSnap) {
                    const snapAngles = [0, 45, 90, 135, 180, 225, 270, 315, 360]
                    for (const snapAngle of snapAngles) {
                        if (Math.abs(degrees - snapAngle) < 4) {
                            degrees = snapAngle % 360
                            break
                        }
                    }
                }

                updateIndicatorItem(activeSelectedId, { rotation: degrees })
            }
        }

        const handleMouseUp = () => setDragMode(null)

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [dragMode, dragStart, isLayoutEditMode, enableMagneticSnap, activeSelectedId, updateIndicatorItem])

    // 2. EARLY RETURNS PLACED AFTER ALL HOOKS
    const pageOverallEnabled = pageConfig?.enabled ?? config.buttonIndicatorEnabled ?? true
    const isInLiveEditMode = isLayoutEditMode || isEditing

    if (!pageOverallEnabled && !isInLiveEditMode) return null

    // Do not render on /admin route unless explicitly editing
    const isHostAdmin = location.pathname === '/admin' || window.location.hash.startsWith('#/admin')
    if (isHostAdmin && !isEditing) return null

    // Helper to render single indicator node
    const renderSingleIndicator = (item: ButtonIndicatorItem, isSelected: boolean) => {
        const text = item.text || 'TEKAN TOMBOL DI SINI ➔'
        const posX = item.x ?? 80
        const posY = item.y ?? 50
        const width = item.width ?? 260
        const height = item.height ?? 70
        const rotation = item.rotation ?? 0
        const bgColor = item.bgColor || '#ef4444'
        const textColor = item.textColor || '#ffffff'
        const borderColor = item.borderColor || '#ffffff'
        const shape = item.shape || 'pill'
        const pulse = item.pulse ?? true
        const fontSize = item.fontSize ?? 16

        let shapeClass = styles.pill
        if (shape === 'rectangle') shapeClass = styles.rectangle
        if (shape === 'badge') shapeClass = styles.badge
        if (shape === 'arrow-right') shapeClass = styles.arrowRight
        if (shape === 'arrow-left') shapeClass = styles.arrowLeft
        if (shape === 'arrow-down') shapeClass = styles.arrowDown
        if (shape === 'arrow-up') shapeClass = styles.arrowUp

        const wrapperStyle: React.CSSProperties = {
            left: `${posX}%`,
            top: `${posY}%`,
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            backgroundColor: bgColor,
            color: textColor,
            border: shape.startsWith('arrow') ? 'none' : `3px solid ${borderColor}`,
            fontSize: `${fontSize}px`
        }

        return (
            <div
                key={item.id}
                className={`${styles.indicatorWrapper} ${shapeClass} ${pulse ? styles.pulseGlow : ''}`}
                style={wrapperStyle}
            >
                <div className={styles.content}>
                    <span>{text}</span>
                </div>
            </div>
        )
    }

    if (isEditing) {
        return (
            <>
                {indicatorsList.map(item => item.enabled !== false && renderSingleIndicator(item, item.id === activeSelectedId))}
            </>
        )
    }

    return (
        <div className={styles.container}>
            {/* Real Page Guidelines Overlay when in Live Edit Mode */}
            {isLayoutEditMode && (
                <>
                    {/* Grid 3x3 */}
                    {showGridLines && (
                        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9990 }}>
                            <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, borderTop: '1px dashed rgba(255,255,255,0.2)' }} />
                            <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, borderTop: '1px dashed rgba(255,255,255,0.2)' }} />
                            <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, borderLeft: '1px dashed rgba(255,255,255,0.2)' }} />
                            <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, borderLeft: '1px dashed rgba(255,255,255,0.2)' }} />
                        </div>
                    )}
                    {/* Center Lines */}
                    {showCenterLines && (
                        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9991 }}>
                            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '2px dashed #ef4444', opacity: 0.8 }} />
                            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, borderLeft: '2px dashed #ef4444', opacity: 0.8 }} />
                        </div>
                    )}
                    {/* Safety Margins */}
                    {showMarginGuides && (
                        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9991 }}>
                            <div style={{ position: 'absolute', inset: '5%', border: '1.5px solid rgba(59, 130, 246, 0.4)', borderRadius: '12px' }} />
                        </div>
                    )}
                </>
            )}

            {/* Render items & Bounding Handles when in Live Edit Mode */}
            {isLayoutEditMode ? (
                indicatorsList.map(item => {
                    if (item.enabled === false) return null
                    const isSelected = item.id === activeSelectedId
                    const posX = item.x ?? 80
                    const posY = item.y ?? 50
                    const width = item.width ?? 260
                    const height = item.height ?? 70
                    const rotation = item.rotation ?? 0

                    return (
                        <div
                            key={item.id}
                            onMouseDown={(e) => handleMouseDown('move', item.id, e)}
                            style={{
                                position: 'absolute',
                                left: `${posX}%`,
                                top: `${posY}%`,
                                width: `${width}px`,
                                height: `${height}px`,
                                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                                transformOrigin: 'center center',
                                cursor: dragMode === 'move' ? 'grabbing' : 'grab',
                                zIndex: isSelected ? 9998 : 9992,
                                pointerEvents: 'auto'
                            }}
                        >
                            {/* Selection Box & Resize Handles if Selected */}
                            {isSelected && (
                                <div style={{
                                    position: 'absolute',
                                    inset: '-8px',
                                    border: '2.5px dashed #3b82f6',
                                    borderRadius: '14px',
                                    pointerEvents: 'none',
                                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.15)'
                                }}>
                                    {/* Rotate Knob */}
                                    <div
                                        onMouseDown={(e) => handleMouseDown('rotate', item.id, e)}
                                        style={{
                                            position: 'absolute',
                                            top: '-32px',
                                            left: '50%',
                                            transform: 'translateX(-50%)',
                                            width: '28px',
                                            height: '28px',
                                            borderRadius: '50%',
                                            backgroundColor: '#3b82f6',
                                            color: '#ffffff',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '16px',
                                            fontWeight: 'bold',
                                            cursor: 'grab',
                                            boxShadow: '0 4px 10px rgba(0,0,0,0.6)',
                                            pointerEvents: 'auto'
                                        }}
                                        title="Tarik untuk memutar indikator (Rotate)"
                                    >
                                        ↻
                                    </div>

                                    {/* Corner Resize Knobs */}
                                    <div onMouseDown={(e) => handleMouseDown('resize-nw', item.id, e)} style={{ position: 'absolute', top: '-6px', left: '-6px', width: '14px', height: '14px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nwse-resize', pointerEvents: 'auto' }} />
                                    <div onMouseDown={(e) => handleMouseDown('resize-ne', item.id, e)} style={{ position: 'absolute', top: '-6px', right: '-6px', width: '14px', height: '14px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nesw-resize', pointerEvents: 'auto' }} />
                                    <div onMouseDown={(e) => handleMouseDown('resize-sw', item.id, e)} style={{ position: 'absolute', bottom: '-6px', left: '-6px', width: '14px', height: '14px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nesw-resize', pointerEvents: 'auto' }} />
                                    <div onMouseDown={(e) => handleMouseDown('resize-se', item.id, e)} style={{ position: 'absolute', bottom: '-6px', right: '-6px', width: '14px', height: '14px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nwse-resize', pointerEvents: 'auto' }} />
                                </div>
                            )}

                            {renderSingleIndicator(item, isSelected)}
                        </div>
                    )
                })
            ) : (
                indicatorsList.map(item => {
                    if (item.enabled === false) return null
                    return (
                        <motion.div
                            key={item.id}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ duration: 0.3 }}
                            style={{ width: '100%', height: '100%', position: 'relative' }}
                        >
                            {renderSingleIndicator(item, false)}
                        </motion.div>
                    )
                })
            )}
        </div>
    )
}
