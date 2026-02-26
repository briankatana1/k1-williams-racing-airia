"use client"

import { createContext, useContext } from "react"

export const PhoneFrameContext = createContext<HTMLElement | null>(null)
export const usePhoneFrame = () => useContext(PhoneFrameContext)
