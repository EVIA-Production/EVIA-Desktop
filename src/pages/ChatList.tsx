import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, MessageSquare, Calendar, Clock, ChevronRight } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useChatList } from '@/hooks/useChatList';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const ChatList = () => {
  const { chats, loading, createNewChat, formatDate } = useChatList();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

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
                        <h3 className="text-lg font-semibold text-white">Chat {index + 1}</h3>
                        <div className="flex items-center space-x-4 text-sm text-gray-400">
                          <div className="flex items-center">
                            <Calendar className="mr-1 h-4 w-4" />
                            {formatDate(chat.last_used_at || chat.created_at)}
                          </div>
                          <div className="flex items-center">
                            <Clock className="mr-1 h-4 w-4" />
                            {new Date(chat.last_used_at || chat.created_at).toLocaleTimeString()}
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
      </div>
    </AppLayout>
  );
};

export default ChatList;
