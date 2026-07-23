import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { useAppConfig } from '../stores'
import { PageButtonIndicatorConfig } from '@shared/types'
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

export function PhysicalButtonIndicator({ isEditing = false, overrideConfig, overridePageKey }: PhysicalButtonIndicatorProps): JSX.Element | null {
    // 1. ALL HOOKS RUN UNCONDITIONALLY AT TOP LEVEL
    const {
        config,
        updateConfig,
        isLayoutEditMode,
        showGridLines,
        showCenterLines,
        showMarginGuides,
        enableMagneticSnap
    } = useAppConfig()

    const location = useLocation()

    const currentPageKey = overridePageKey || getPageKeyFromRoute(location.pathname, window.location.hash)
    const pageMap = config.pageButtonIndicators || {}
    const pageConfig = pageMap[currentPageKey] || {}

    // Helper to update specific page config in Zustand store
    const updatePageConfig = useCallback((updates: Partial<PageButtonIndicatorConfig>) => {
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
    }, [config.pageButtonIndicators, currentPageKey, updateConfig])

    const activeConfig = overrideConfig || {
        enabled: pageConfig.enabled ?? config.buttonIndicatorEnabled ?? false,
        text: pageConfig.text ?? config.buttonIndicatorText ?? 'TEKAN TOMBOL DI SINI ➔',
        x: pageConfig.x ?? config.buttonIndicatorX ?? 80,
        y: pageConfig.y ?? config.buttonIndicatorY ?? 50,
        width: pageConfig.width ?? config.buttonIndicatorWidth ?? 260,
        height: pageConfig.height ?? config.buttonIndicatorHeight ?? 70,
        rotation: pageConfig.rotation ?? config.buttonIndicatorRotation ?? 0,
        bgColor: pageConfig.bgColor ?? config.buttonIndicatorBgColor ?? '#ef4444',
        textColor: pageConfig.textColor ?? config.buttonIndicatorTextColor ?? '#ffffff',
        borderColor: pageConfig.borderColor ?? config.buttonIndicatorBorderColor ?? '#ffffff',
        shape: pageConfig.shape ?? config.buttonIndicatorShape ?? 'pill',
        pulse: pageConfig.pulse ?? config.buttonIndicatorPulse ?? true,
        fontSize: pageConfig.fontSize ?? config.buttonIndicatorFontSize ?? 16
    }

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

    const handleMouseDown = useCallback((mode: DragMode, e: React.MouseEvent) => {
        if (!isLayoutEditMode) return
        e.stopPropagation()
        e.preventDefault()
        setDragStart({
            mouseX: e.clientX,
            mouseY: e.clientY,
            posX: activeConfig.x,
            posY: activeConfig.y,
            width: activeConfig.width,
            height: activeConfig.height,
            rotation: activeConfig.rotation
        })
        setDragMode(mode)
    }, [isLayoutEditMode, activeConfig.x, activeConfig.y, activeConfig.width, activeConfig.height, activeConfig.rotation])

    useEffect(() => {
        if (!dragMode || !isLayoutEditMode) return

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

                updatePageConfig({
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

                updatePageConfig({
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

                updatePageConfig({ rotation: degrees })
            }
        }

        const handleMouseUp = () => setDragMode(null)

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [dragMode, dragStart, isLayoutEditMode, enableMagneticSnap, updatePageConfig])

    // 2. EARLY RETURNS PLACED AFTER ALL HOOKS
    const isEnabled = activeConfig.enabled ?? false
    const isInLiveEditMode = isLayoutEditMode || isEditing

    if (!isEnabled && !isInLiveEditMode) return null

    // Do not render on /admin route unless explicitly editing
    const isHostAdmin = location.pathname === '/admin' || window.location.hash.startsWith('#/admin')
    if (isHostAdmin && !isEditing) return null

    const text = activeConfig.text || 'TEKAN TOMBOL DI SINI ➔'
    const posX = activeConfig.x ?? 80
    const posY = activeConfig.y ?? 50
    const width = activeConfig.width ?? 260
    const height = activeConfig.height ?? 70
    const rotation = activeConfig.rotation ?? 0
    const bgColor = activeConfig.bgColor || '#ef4444'
    const textColor = activeConfig.textColor || '#ffffff'
    const borderColor = activeConfig.borderColor || '#ffffff'
    const shape = activeConfig.shape || 'pill'
    const pulse = activeConfig.pulse ?? true
    const fontSize = activeConfig.fontSize ?? 16

    // Shape class mapping
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

    const contentNode = (
        <div
            className={`${styles.indicatorWrapper} ${shapeClass} ${pulse ? styles.pulseGlow : ''}`}
            style={wrapperStyle}
        >
            <div className={styles.content}>
                <span>{text}</span>
            </div>
        </div>
    )

    if (isEditing) {
        return contentNode
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

            {/* Interactive Bounding Controls in Live Edit Mode */}
            {isLayoutEditMode ? (
                <div
                    onMouseDown={(e) => handleMouseDown('move', e)}
                    style={{
                        position: 'absolute',
                        left: `${posX}%`,
                        top: `${posY}%`,
                        width: `${width}px`,
                        height: `${height}px`,
                        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                        transformOrigin: 'center center',
                        cursor: dragMode === 'move' ? 'grabbing' : 'grab',
                        zIndex: 9998,
                        pointerEvents: 'auto'
                    }}
                >
                    {/* Bounding Box & Handles */}
                    <div style={{
                        position: 'absolute',
                        inset: '-8px',
                        border: '2px dashed #3b82f6',
                        borderRadius: '14px',
                        pointerEvents: 'none',
                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.15)'
                    }}>
                        {/* Rotate Knob */}
                        <div
                            onMouseDown={(e) => handleMouseDown('rotate', e)}
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
                        <div onMouseDown={(e) => handleMouseDown('resize-nw', e)} style={{ position: 'absolute', top: '-6px', left: '-6px', width: '14px', height: '14px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nwse-resize', pointerEvents: 'auto' }} />
                        <div onMouseDown={(e) => handleMouseDown('resize-ne', e)} style={{ position: 'absolute', top: '-6px', right: '-6px', width: '14px', height: '14px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nesw-resize', pointerEvents: 'auto' }} />
                        <div onMouseDown={(e) => handleMouseDown('resize-sw', e)} style={{ position: 'absolute', bottom: '-6px', left: '-6px', width: '14px', height: '14px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nesw-resize', pointerEvents: 'auto' }} />
                        <div onMouseDown={(e) => handleMouseDown('resize-se', e)} style={{ position: 'absolute', bottom: '-6px', right: '-6px', width: '14px', height: '14px', background: '#3b82f6', border: '2px solid white', borderRadius: '50%', cursor: 'nwse-resize', pointerEvents: 'auto' }} />
                    </div>

                    {contentNode}
                </div>
            ) : (
                <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.3 }}
                    style={{ width: '100%', height: '100%', position: 'relative' }}
                >
                    {contentNode}
                </motion.div>
            )}
        </div>
    )
}
