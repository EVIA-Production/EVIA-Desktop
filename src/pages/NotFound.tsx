
import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import EviaLogo from "@/components/EviaLogo";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-black to-gray-900 text-white p-4">
      <div className="text-center max-w-md w-full p-8 bg-gray-900 rounded-lg border border-gray-800 shadow-xl">
        <EviaLogo className="mx-auto mb-6 text-3xl text-white" />
        <h1 className="text-5xl font-bold mb-2">404</h1>
        <p className="text-xl text-gray-400 mb-6">Page not found</p>
        <p className="text-gray-500 mb-8">
          The page you're looking for doesn't exist or you might not have access to it.
        </p>
        <Link to="/">
          <Button className="bg-evia-pink hover:bg-pink-700">
            Return to Home
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
