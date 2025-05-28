import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, MessageSquare, Calendar, Clock, ChevronRight, Edit2, Check, X, Trash2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useChatList } from '@/hooks/useChatList';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ChatList = () => {
  const { chats, loading, createNewChat, formatDate, updateChatName, deleteChat } = useChatList();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);

  useEffect(() => {
    // Don't redirect while still loading authentication state
    if (isLoading) {
      return;
    }
    
    // Redirect to login if not authenticated
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handleChatSelect = (chatId: string) => {
    localStorage.setItem('selectedChatId', chatId);
    navigate('/');
  };

  const handleEditClick = (e: React.MouseEvent, chatId: string, currentName: string) => {
    e.stopPropagation();
    setEditingChatId(chatId);
    setEditingName(currentName);
  };

  const handleSaveEdit = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    try {
      await updateChatName(chatId, editingName);
      setEditingChatId(null);
      toast({
        title: 'Success',
        description: 'Chat name updated successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update chat name. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(null);
  };

  const handleDeleteClick = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    setChatToDelete(chatId);
  };

  const handleConfirmDelete = async () => {
    if (!chatToDelete) return;
    
    try {
      await deleteChat(chatToDelete);
      toast({
        title: 'Success',
        description: 'Chat deleted successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete chat. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setChatToDelete(null);
    }
  };

  // Show loading while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-black to-gray-900">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  // If not authenticated, don't render the content (will be redirected)
  if (!isAuthenticated) {
    return null;
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <div className="text-white text-xl animate-pulse">Loading your conversations...</div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex justify-between items-center mb-8"
        >
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Your Conversations</h1>
            <p className="text-gray-400">Manage and continue your AI conversations</p>
          </div>
          <Button 
            onClick={createNewChat}
            className="bg-primary hover:bg-primary/90 transition-all duration-200 transform hover:scale-105"
            size="lg"
          >
            <Plus className="mr-2 h-5 w-5" />
            New Chat
          </Button>
        </motion.div>

        {chats.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-16 bg-card/50 rounded-lg border border-border"
          >
            <MessageSquare className="mx-auto h-20 w-20 text-primary/50 mb-6" />
            <h2 className="text-2xl font-semibold text-white mb-3">No conversations yet</h2>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              Start your first conversation with our AI assistant. Ask questions, get help, or just chat!
            </p>
            <Button 
              onClick={createNewChat} 
              className="bg-primary hover:bg-primary/90 transition-all duration-200 transform hover:scale-105"
              size="lg"
            >
              <Plus className="mr-2 h-5 w-5" />
              Start Your First Chat
            </Button>
          </motion.div>
        ) : (
          <div className="space-y-3">
            {chats.map((chat, index) => (
              <motion.div
                key={chat.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card 
                  className="bg-card/50 border-border hover:bg-accent/50 transition-all duration-200 cursor-pointer group"
                  onClick={() => handleChatSelect(String(chat.id))}
                >
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center space-x-4">
                      <div className="bg-primary/10 p-3 rounded-full">
                        <MessageSquare className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        {editingChatId === String(chat.id) ? (
                          <div className="flex items-center space-x-2">
                            <Input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="bg-background/50 text-white border-border"
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => handleSaveEdit(e, String(chat.id))}
                              className="text-green-500 hover:text-green-600"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleCancelEdit}
                              className="text-red-500 hover:text-red-600"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2">
                            <h3 className="text-lg font-semibold text-white">{chat.name || `Chat ${index + 1}`}</h3>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => handleEditClick(e, String(chat.id), chat.name || `Chat ${index + 1}`)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Edit2 className="h-4 w-4 text-gray-400 hover:text-primary" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => handleDeleteClick(e, String(chat.id))}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="h-4 w-4 text-gray-400 hover:text-red-500" />
                            </Button>
                          </div>
                        )}
                        <div className="flex items-center space-x-4 text-sm text-gray-400">
                          <div className="flex items-center">
                            <Calendar className="mr-1 h-4 w-4" />
                            {formatDate(chat.last_used_at || chat.created_at)}
                          </div>
                          <div className="flex items-center">
                            <Clock className="mr-1 h-4 w-4" />
                            {new Date(chat.last_used_at || chat.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-primary transition-colors" />
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        <AlertDialog open={!!chatToDelete} onOpenChange={() => setChatToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the chat and all its messages.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
};

export default ChatList;
