import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const About = () => {
  const navigate = useNavigate();

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center mb-8">
        <Button
          variant="outline"
          className="border-border bg-transparent hover:bg-accent text-muted-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
      
      <h1 className="text-4xl font-bold mb-8 text-center">About EVIA</h1>
      
      <Tabs defaultValue="about" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="about">About & Tutorial</TabsTrigger>
          <TabsTrigger value="privacy">Privacy Policy</TabsTrigger>
        </TabsList>
        
        <TabsContent value="about">
          <Card>
            <CardHeader>
              <CardTitle>About EVIA</CardTitle>
              <CardDescription>Your AI-powered virtual assistant</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] pr-4">
                <div className="space-y-6">
                  <section>
                    <h2 className="text-2xl font-semibold mb-4">What is EVIA?</h2>
                    <p className="text-gray-700 dark:text-gray-300">
                      EVIA is an advanced AI-powered virtual assistant designed to help you with various tasks
                      and provide intelligent responses to your queries. Our platform combines cutting-edge
                      artificial intelligence with user-friendly interfaces to deliver a seamless experience.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">Getting Started</h2>
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-xl font-medium mb-2">1. Create an Account</h3>
                        <p className="text-gray-700 dark:text-gray-300">
                          Sign up for an account to access all features of EVIA. The registration process
                          is quick and straightforward.
                        </p>
                      </div>
                      <div>
                        <h3 className="text-xl font-medium mb-2">2. Start a Chat</h3>
                        <p className="text-gray-700 dark:text-gray-300">
                          Navigate to the chat section and start a new conversation with EVIA. You can
                          ask questions, request assistance, or engage in meaningful discussions.
                        </p>
                      </div>
                      <div>
                        <h3 className="text-xl font-medium mb-2">3. Explore Features</h3>
                        <p className="text-gray-700 dark:text-gray-300">
                          Discover the various features and capabilities of EVIA. From answering questions
                          to providing detailed explanations, EVIA is here to help.
                        </p>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">Tips for Best Results</h2>
                    <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
                      <li>Be specific in your questions for more accurate responses</li>
                      <li>Use clear and concise language</li>
                      <li>Provide context when necessary</li>
                      <li>Feel free to ask follow-up questions</li>
                    </ul>
                  </section>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="privacy">
          <Card>
            <CardHeader>
              <CardTitle>Privacy Policy</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px] pr-4">
                <div className="space-y-6 text-gray-700 dark:text-gray-300">
                  <section>
                    <h2 className="text-2xl font-semibold mb-4">1. Who we are</h2>
                    <p>EVIA GBR, Munich, Germany. Contact us: bene.kroetz@gmail.com</p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">2. Data we collect</h2>
                    <ul className="list-disc pl-6 space-y-2">
                      <li>Your interview audio recordings.</li>
                      <li>Transcripts of them.</li>
                      <li>Metadata: IP, time, device.</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">3. Why we need it</h2>
                    <ul className="list-disc pl-6 space-y-2">
                      <li>Transcription in real time.</li>
                      <li>Recommendations for conversations.</li>
                      <li>Improving our system.</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">4. Legal basis</h2>
                    <ul className="list-disc pl-6 space-y-2">
                      <li>Your consent.</li>
                      <li>Our legitimate interest in helping you.</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">5. Who receives the data (when using EVIA)</h2>
                    <ul className="list-disc pl-6 space-y-2">
                      <li>Deepgram (USA): Transcription.</li>
                      <li>Groq (USA): Recommendations.</li>
                      <li>Microsoft Azure (EU): Storage.</li>
                    </ul>
                    <p className="mt-2">Data goes to the US, but we have safeguards (SCCs).</p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">6. How long we keep them</h2>
                    <ul className="list-disc pl-6 space-y-2">
                      <li>Audio: Deleted after 24 hours.</li>
                      <li>Transcripts: Until you delete them or pilot phase ends.</li>
                      <li>Metadata: As long as necessary.</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">7. Your rights</h2>
                    <ul className="list-disc pl-6 space-y-2">
                      <li>Look at your data.</li>
                      <li>Change them.</li>
                      <li>Delete it.</li>
                      <li>Say no to processing.</li>
                      <li>Take your data with you.</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">8. Security</h2>
                    <p>We encrypt everything. Only authorized persons have access.</p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold mb-4">9. Changes</h2>
                    <p>We update this. New versions are on our website.</p>
                  </section>

                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default About; 