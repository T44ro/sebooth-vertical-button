import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import QRCode from 'react-qr-code'
import { useFrameStore, useAppConfig, useSessionStore } from '../stores'
import { SessionTimer } from '../components/SessionTimer'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './PaymentGateway.module.css'

interface PaymentState {
    status: 'idle' | 'pending' | 'success' | 'failed' | 'expired'
    orderId: string | null
    qrisUrl: string | null
    qrString: string | null
    transactionId: string | null
    expiredDatetime: string | null
}

function PaymentGateway(): JSX.Element {
    const navigate = useNavigate()
    const { activeFrame } = useFrameStore()
    const { config } = useAppConfig()
    const { startSession, endSession } = useSessionStore()

    const [additionalPrints, setAdditionalPrints] = useState(0)
    const [payment, setPayment] = useState<PaymentState>({
        status: 'idle',
        orderId: null,
        qrisUrl: null,
        qrString: null,
        transactionId: null,
        expiredDatetime: null
    })
    const [isCreatingOrder, setIsCreatingOrder] = useState(false)
    const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)

    const [paymentTimeLeft, setPaymentTimeLeft] = useState<number>(300)

    // Expiration countdown timer effect
    useEffect(() => {
        if (payment.status !== 'pending') return

        let targetTime: number
        if (payment.expiredDatetime) {
            targetTime = new Date(payment.expiredDatetime).getTime()
        } else {
            targetTime = Date.now() + (config.paymentTimeout || 300) * 1000
        }

        const updateTimer = () => {
            const diff = Math.max(0, Math.floor((targetTime - Date.now()) / 1000))
            setPaymentTimeLeft(diff)
            if (diff <= 0) {
                setPayment(prev => ({ ...prev, status: 'expired' }))
            }
        }

        updateTimer()
        const timerInterval = setInterval(updateTimer, 1000)

        return () => clearInterval(timerInterval)
    }, [payment.status, payment.expiredDatetime, config.paymentTimeout])

    // Format MM:SS
    const formatTimeLeft = (totalSec: number): string => {
        const m = Math.floor(totalSec / 60).toString().padStart(2, '0')
        const s = (totalSec % 60).toString().padStart(2, '0')
        return `${m}:${s}`
    }

    // Calculate total price
    const totalPrice = config.sessionPrice + (additionalPrints * config.additionalPrintPrice)

    // Handle print quantity change (multiples of 2)
    const handlePrintChange = (delta: number): void => {
        setAdditionalPrints(prev => Math.max(0, prev + delta))
    }

    // Create QRIS order
    const createOrder = async (): Promise<void> => {
        const isDoku = config.paymentGateway === 'doku'
        
        if (isDoku) {
            if (!config.dokuClientId || !config.dokuSecretKey) {
                alert('DOKU Client ID atau Secret Key belum dikonfigurasi di Admin Panel')
                return
            }
        } else {
            if (!config.midtransServerKey) {
                alert('Midtrans Server Key belum dikonfigurasi di Admin Panel')
                return
            }
        }

        setIsCreatingOrder(true)
        const orderId = `SEBOOTH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

        try {
            if (isDoku) {
                // Call electron main IPC to create Doku session securely & download QR
                const res = await (window as any).api.payment.dokuCreateSession({
                    orderId: orderId,
                    amount: totalPrice
                })

                if (res.success && res.data) {
                    setPayment({
                        status: 'pending',
                        orderId: orderId,
                        qrisUrl: res.data.qrisUrl || res.data.paymentUrl,
                        qrString: res.data.qrString || null,
                        transactionId: null,
                        expiredDatetime: res.data.expiredDatetime || null
                    })
                    startPolling(orderId)
                } else {
                    throw new Error(res.error || 'Gagal membuat sesi pembayaran DOKU')
                }
            } else {
                // Create Midtrans transaction
                const auth = btoa(`${config.midtransServerKey}:`)
                const response = await fetch('https://api.sandbox.midtrans.com/v2/charge', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Basic ${auth}`,
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        payment_type: 'qris',
                        transaction_details: {
                            order_id: orderId,
                            gross_amount: totalPrice
                        },
                        qris: {
                            acquirer: 'gopay'
                        }
                    })
                })

                const data = await response.json()

                if (data.actions && data.actions[0]) {
                    const qrisAction = data.actions.find((a: { name: string }) => a.name === 'generate-qr-code')
                    setPayment({
                        status: 'pending',
                        orderId: orderId,
                        qrisUrl: qrisAction?.url || data.actions[0].url,
                        qrString: data.qr_string || null,
                        transactionId: data.transaction_id,
                        expiredDatetime: data.expiry_time || null
                    })

                    // Start polling for payment status
                    startPolling(orderId)
                } else if (data.status_code === '201' || data.status_code === '200') {
                    setPayment({
                        status: 'pending',
                        orderId: orderId,
                        qrisUrl: data.qr_string ? null : (data.actions?.[0]?.url || null),
                        qrString: data.qr_string || null,
                        transactionId: data.transaction_id,
                        expiredDatetime: data.expiry_time || null
                    })
                    startPolling(orderId)
                } else {
                    throw new Error(data.status_message || 'Failed to create order')
                }
            }
        } catch (err) {
            console.error('Payment error:', err)
            setPayment(prev => ({ ...prev, status: 'failed' }))
            alert('Gagal membuat pembayaran: ' + (err as Error).message)
        } finally {
            setIsCreatingOrder(false)
        }
    }

    // Poll for payment status
    const startPolling = (orderId: string): void => {
        if (pollInterval) clearInterval(pollInterval)
        const isDoku = config.paymentGateway === 'doku'

        const interval = setInterval(async () => {
            try {
                if (isDoku) {
                    const res = await (window as any).api.payment.dokuCheckStatus({
                        invoiceNumber: orderId
                    })

                    if (res.success && res.data) {
                        const status = res.data.status // PENDING, SUCCESS, FAILED
                        if (status === 'SUCCESS') {
                            clearInterval(interval)
                            setPollInterval(null)
                            setPayment(prev => ({ ...prev, status: 'success' }))

                            // Start session and navigate to capture with paid print quantity
                            setTimeout(() => {
                                if (activeFrame) {
                                    const paidQuantity = 2 + additionalPrints
                                    startSession(activeFrame.id, paidQuantity)
                                }
                                navigate('/capture')
                            }, 2000)
                        } else if (status === 'FAILED') {
                            clearInterval(interval)
                            setPollInterval(null)
                            setPayment(prev => ({ ...prev, status: 'failed' }))
                        }
                    }
                } else {
                    const auth = btoa(`${config.midtransServerKey}:`)
                    const response = await fetch(
                        `https://api.sandbox.midtrans.com/v2/${orderId}/status`,
                        {
                            headers: {
                                'Authorization': `Basic ${auth}`,
                                'Accept': 'application/json'
                            }
                        }
                    )
                    const data = await response.json()

                    if (data.transaction_status === 'settlement' || data.transaction_status === 'capture') {
                        clearInterval(interval)
                        setPollInterval(null)
                        setPayment(prev => ({ ...prev, status: 'success' }))

                        // Start session and navigate to capture with paid print quantity
                        setTimeout(() => {
                            if (activeFrame) {
                                const paidQuantity = 2 + additionalPrints
                                startSession(activeFrame.id, paidQuantity)
                            }
                            navigate('/capture')
                        }, 2000)
                    } else if (data.transaction_status === 'expire' || data.transaction_status === 'cancel') {
                        clearInterval(interval)
                        setPollInterval(null)
                        setPayment(prev => ({ ...prev, status: 'expired' }))
                    }
                }
            } catch (err) {
                console.error('Status check error:', err)
            }
        }, 4000) // Poll every 4 seconds

        setPollInterval(interval)
    }

    useEffect(() => {
        return () => {
            if (pollInterval) clearInterval(pollInterval)
        }
    }, [pollInterval])

    // Handle timeout
    const handleTimeout = useCallback((): void => {
        if (pollInterval) clearInterval(pollInterval)
        navigate('/')
    }, [pollInterval, navigate])

    // Handle back
    const handleBack = (): void => {
        if (pollInterval) clearInterval(pollInterval)
        navigate('/frames')
    }

    const handleBackHome = (): void => {
        if (pollInterval) clearInterval(pollInterval)
        setIsConfirmModalOpen(true)
    }

    const handleConfirmBackHome = (): void => {
        endSession()
        navigate('/')
    }

    // Handle skip (for testing)
    const handleSkip = (): void => {
        if (activeFrame) {
            const paidQuantity = 2 + additionalPrints
            startSession(activeFrame.id, paidQuantity)
        }
        navigate('/capture')
    }

    // Keyboard navigation

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            if (e.key === '1') {
                e.preventDefault()
                if (additionalPrints > 0) {
                    handlePrintChange(-2)
                }
            } else if (e.key === '3') {
                e.preventDefault()
                handlePrintChange(2)
            } else if (e.key === '2') {
                e.preventDefault()
                if (payment.status === 'idle') {
                    createOrder()
                } else if (payment.status === 'expired' || payment.status === 'failed') {
                    setPayment({ status: 'idle', orderId: null, qrisUrl: null, qrString: null, transactionId: null, expiredDatetime: null })
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [additionalPrints, payment.status, createOrder])


    if (!activeFrame) {
        return (
            <div className={styles.container}>
                <div className={styles.noFrame}>
                    <h2>No Frame Selected</h2>
                    <button onClick={() => navigate('/frames')}>Select Frame</button>
                </div>
            </div>
        )
    }

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <SessionTimer
                duration={config.paymentTimeout}
                onTimeout={handleTimeout}
                enabled={config.sessionTimerEnabled}
                label="Payment"
            />

            <div className={styles.content}>
                <header className={styles.header}>
                    <button onClick={handleBack} className={styles.backBtn}>
                        ← Back
                    </button>
                    <h1>Payment</h1>
                </header>

                <div className={`${styles.mainContent} ${payment.status === 'idle' && !isCreatingOrder ? styles.idleState : ''} ${payment.status === 'pending' || isCreatingOrder ? styles.qrActive : ''}`}>
                    {/* Left - Price Summary */}
                    <div className={`${styles.priceSection} ${payment.status === 'pending' || isCreatingOrder ? styles.hiddenOnQr : ''}`}>
                        <div className={styles.orderSummaryHeader}>
                            <h2>Order Summary</h2>
                            <div className={styles.priceItem}>
                                <span>Session (1x 4R print)</span>
                                <span>Rp {config.sessionPrice.toLocaleString('id-ID')}</span>
                            </div>
                        </div>

                        <div className={styles.additionalPrintSection}>
                            <div className={styles.printSelector}>
                                <span className={styles.printSelectorTitle}>Additional Prints (per 2)</span>
                                <div className={styles.quantityControls}>
                                    <button
                                        onClick={() => handlePrintChange(-2)}
                                        disabled={additionalPrints === 0}
                                    >
                                        −
                                    </button>
                                    <span>{additionalPrints}</span>
                                    <button onClick={() => handlePrintChange(2)}>+</button>
                                </div>
                            </div>

                            {additionalPrints > 0 && (
                                <div className={styles.priceItem}>
                                    <span>Extra prints ({additionalPrints}x)</span>
                                    <span>Rp {(additionalPrints * config.additionalPrintPrice).toLocaleString('id-ID')}</span>
                                </div>
                            )}
                        </div>

                        <div className={styles.orderSummaryFooter}>
                            <div className={styles.priceDivider}></div>

                            <div className={styles.totalPrice}>
                                <span>Total</span>
                                <span>Rp {totalPrice.toLocaleString('id-ID')}</span>
                            </div>

                            {payment.status === 'idle' && (
                                <button
                                    className={styles.payButton}
                                    onClick={createOrder}
                                    disabled={isCreatingOrder}
                                >
                                    {isCreatingOrder ? 'Generating QRIS...' : 'Bayar Sekarang'}
                                </button>
                            )}
                        </div>
                    </div>

                    {(isCreatingOrder || payment.status !== 'idle') && (
                        <div className={styles.qrSection}>
                            {isCreatingOrder && (
                                <div className={styles.loadingDisplay}>
                                    <div className={styles.spinnerLarge}></div>
                                    <h3>Mendownload Kode QRIS...</h3>
                                    <p>Mohon tunggu sebentar, sistem sedang menyiapkan kode pembayaran Anda.</p>
                                </div>
                            )}

                        {!isCreatingOrder && payment.status === 'idle' && null}

                        {!isCreatingOrder && payment.status === 'pending' && (payment.qrString || payment.qrisUrl) && (
                            <div className={styles.qrDisplay}>
                                {/* Countdown Timer Badge */}
                                <div className={styles.timerBadge}>
                                    <span className={styles.timerIcon}>⏰</span>
                                    <div className={styles.timerInfo}>
                                        <span className={styles.timerLabel}>Sisa Waktu Pembayaran</span>
                                        <span className={styles.timerValue}>{formatTimeLeft(paymentTimeLeft)}</span>
                                    </div>
                                </div>

                                <div className={styles.qrCodeContainer}>
                                    {payment.qrString ? (
                                        <div className={styles.qrWrapper}>
                                            <QRCode value={payment.qrString} size={340} />
                                        </div>
                                    ) : payment.qrisUrl && (payment.qrisUrl.startsWith('data:image') || payment.qrisUrl.startsWith('http')) ? (
                                        <div className={styles.qrWrapper}>
                                            <img src={payment.qrisUrl} alt="Kode QRIS" className={styles.qrImage} />
                                        </div>
                                    ) : (
                                        <div className={styles.qrWrapper}>
                                            <QRCode value={payment.qrisUrl || ''} size={340} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {payment.status === 'success' && (
                            <div className={styles.successDisplay}>
                                <span className={styles.successIcon}>✓</span>
                                <h3>Pembayaran Berhasil!</h3>
                                <p>Mengalihkan ke sesi foto...</p>
                            </div>
                        )}

                        {payment.status === 'expired' && (
                            <div className={styles.errorDisplay}>
                                <span>⏰</span>
                                <h3>Waktu Pembayaran Habis</h3>
                                <button onClick={() => setPayment({ status: 'idle', orderId: null, qrisUrl: null, qrString: null, transactionId: null, expiredDatetime: null })}>
                                    Coba Lagi
                                </button>
                            </div>
                        )}

                        {payment.status === 'failed' && (
                            <div className={styles.errorDisplay}>
                                <span>❌</span>
                                <h3>Pembayaran Gagal</h3>
                                <button onClick={() => setPayment({ status: 'idle', orderId: null, qrisUrl: null, qrString: null, transactionId: null, expiredDatetime: null })}>
                                    Coba Lagi
                                </button>
                            </div>
                        )}
                    </div>
                )}
                </div>

            </div>

            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={handleConfirmBackHome}
            />
        </motion.div>
    )
}

export default PaymentGateway
