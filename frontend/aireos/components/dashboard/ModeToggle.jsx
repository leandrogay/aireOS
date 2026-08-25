"use client"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function ModeToggle({ mode, onModeChange }) {
  return (
    <Tabs value={mode} onValueChange={onModeChange}>
      <TabsList>
        <TabsTrigger value="offline">Offline</TabsTrigger>
        <TabsTrigger value="online">Online</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
